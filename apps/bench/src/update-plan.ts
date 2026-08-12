import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

export const ROW_MODEL_BATCH_INTERVAL_MS = 50;
export const ROW_MODEL_PATCH_RATE_PER_SEC = 1_000;
export const ROW_MODEL_PATCHES_PER_TICK =
  (ROW_MODEL_PATCH_RATE_PER_SEC * ROW_MODEL_BATCH_INTERVAL_MS) / 1_000;
export const ROW_MODEL_DURATION_MS = 3_000;

export interface DeterministicUpdatePatch {
  readonly id: string;
  readonly columnId: string;
  readonly value: string | number;
  readonly changes: Readonly<Record<string, string | number>>;
}

export interface DeterministicUpdateTick {
  readonly index: number;
  readonly atMs: number;
  readonly patches: readonly DeterministicUpdatePatch[];
}

export interface DeterministicUpdatePlan {
  readonly seed: number;
  readonly ticks: readonly DeterministicUpdateTick[];
  readonly totalPatches: number;
  readonly scheduleChecksum: string;
  readonly grouping: {
    readonly initialExpansion: { readonly kind: "expanded" };
    readonly rowGroups: readonly [{ readonly columnId: "col_1" }];
    readonly aggregate: {
      readonly columnId: "col_3";
      readonly operation: "sum";
    };
    readonly sort: readonly [
      { readonly columnId: "col_3"; readonly direction: "asc" },
    ];
  } | null;
  readonly rebuild: {
    readonly startAfterTick: 10;
    readonly sort: readonly [
      { readonly columnId: "col_3"; readonly direction: "desc" },
    ];
    readonly preservesSourceRowCount: true;
    readonly preservesGroupCount: true;
  } | null;
}

export function createDeterministicUpdatePlan(input: {
  readonly dataset: Pick<ScenarioDataset, "rows" | "columns">;
  readonly grouped: boolean;
  readonly seed: number;
  readonly patchRatePerSec?: number;
}): DeterministicUpdatePlan {
  if (input.dataset.rows.length === 0 || input.dataset.columns.length === 0) {
    throw new Error("The deterministic update plan requires rows and columns.");
  }
  const random = mulberry32(input.seed >>> 0);
  let ordinal = 0;
  const tickCount = ROW_MODEL_DURATION_MS / ROW_MODEL_BATCH_INTERVAL_MS;
  const patchesPerTick = Math.max(
    1,
    Math.round(
      ((input.patchRatePerSec ?? ROW_MODEL_PATCH_RATE_PER_SEC) *
        ROW_MODEL_BATCH_INTERVAL_MS) /
        1_000,
    ),
  );
  const ticks = Array.from({ length: tickCount }, (_, tickIndex) => {
    const patches = Array.from(
      { length: patchesPerTick },
      (): DeterministicUpdatePatch => {
        const currentOrdinal = ordinal++;
        const rowIndex = Math.floor(random() * input.dataset.rows.length);
        const columnIndex = Math.floor(random() * input.dataset.columns.length);
        const row = input.dataset.rows[rowIndex]!;
        const columnId = input.dataset.columns[columnIndex]!.id;
        const id = String(row.id ?? rowIndex);
        const value = createPatchValue(
          columnId,
          input.seed,
          currentOrdinal,
          random,
        );
        return Object.freeze({
          id,
          columnId,
          value,
          changes: Object.freeze({ [columnId]: value }),
        });
      },
    );
    return Object.freeze({
      index: tickIndex,
      atMs: (tickIndex + 1) * ROW_MODEL_BATCH_INTERVAL_MS,
      patches: Object.freeze(patches),
    });
  });
  const scheduleChecksum = checksumStrings(
    ticks.flatMap((tick) =>
      tick.patches.map((patch) => `${patch.id}\u0000${patch.columnId}`),
    ),
  );

  return Object.freeze({
    seed: input.seed,
    ticks: Object.freeze(ticks),
    totalPatches: ordinal,
    scheduleChecksum,
    grouping: input.grouped
      ? Object.freeze({
          initialExpansion: Object.freeze({ kind: "expanded" as const }),
          rowGroups: Object.freeze([
            Object.freeze({ columnId: "col_1" as const }),
          ]) as readonly [{ readonly columnId: "col_1" }],
          aggregate: Object.freeze({
            columnId: "col_3" as const,
            operation: "sum" as const,
          }),
          sort: Object.freeze([
            Object.freeze({
              columnId: "col_3" as const,
              direction: "asc" as const,
            }),
          ]) as readonly [
            { readonly columnId: "col_3"; readonly direction: "asc" },
          ],
        })
      : null,
    rebuild: input.grouped
      ? Object.freeze({
          startAfterTick: 10 as const,
          sort: Object.freeze([
            Object.freeze({
              columnId: "col_3" as const,
              direction: "desc" as const,
            }),
          ]) as readonly [
            { readonly columnId: "col_3"; readonly direction: "desc" },
          ],
          preservesSourceRowCount: true as const,
          preservesGroupCount: true as const,
        })
      : null,
  });
}

export function applyUpdatePlanToRows(
  rows: readonly ScenarioRow[],
  plan: DeterministicUpdatePlan,
): readonly ScenarioRow[] {
  const byId = new Map(rows.map((row) => [String(row.id ?? ""), { ...row }]));
  for (const tick of plan.ticks) {
    for (const patch of tick.patches) {
      const row = byId.get(patch.id);
      if (row !== undefined) Object.assign(row, patch.changes);
    }
  }
  return rows.map((row) => byId.get(String(row.id ?? ""))!);
}

export function checksumScenarioRows(rows: readonly ScenarioRow[]): string {
  return checksumStrings(
    [...rows]
      .sort((left, right) =>
        String(left.id ?? "").localeCompare(String(right.id ?? "")),
      )
      .map((row) =>
        JSON.stringify(
          Object.keys(row)
            .sort()
            .map((key) => [key, row[key]]),
        ),
      ),
  );
}

function createPatchValue(
  columnId: string,
  seed: number,
  ordinal: number,
  random: () => number,
): string | number {
  if (columnId === "col_1") return `group-${seed}-${ordinal}`;
  if (columnId === "col_3") return Math.floor(random() * 100_000) / 100;
  return `upd-${seed}-${ordinal}`;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function checksumStrings(values: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
