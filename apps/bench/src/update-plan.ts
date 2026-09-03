import {
  type ScenarioDataset,
  type ScenarioPatchStreamRipple,
  type ScenarioRoles,
  type ScenarioRow,
} from "@pretable-internal/scenario-data";

export const ROW_MODEL_BATCH_INTERVAL_MS = 50;
export const ROW_MODEL_PATCH_RATE_PER_SEC = 1_000;
export const ROW_MODEL_PATCHES_PER_TICK =
  (ROW_MODEL_PATCH_RATE_PER_SEC * ROW_MODEL_BATCH_INTERVAL_MS) / 1_000;
export const ROW_MODEL_DURATION_MS = 3_000;

/**
 * One streamed cell write. `changes` is authoritative — a ripple patch holds
 * the tick column plus every derived column. `columnId`/`value` mirror the
 * tick (or the single uniform cell) for readers that still key on one cell.
 */
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
    readonly rowGroups: readonly { readonly columnId: string }[];
    readonly aggregate: {
      readonly columnId: string;
      readonly operation: "sum";
    };
    readonly sort: readonly [
      { readonly columnId: string; readonly direction: "asc" },
    ];
  } | null;
  readonly rebuild: {
    readonly startAfterTick: 10;
    readonly sort: readonly [
      { readonly columnId: string; readonly direction: "desc" },
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
  readonly roles: Pick<ScenarioRoles, "stream" | "streamingGrouping">;
}): DeterministicUpdatePlan {
  if (input.dataset.rows.length === 0 || input.dataset.columns.length === 0) {
    throw new Error("The deterministic update plan requires rows and columns.");
  }
  const { stream, streamingGrouping } = input.roles;
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
  const working = new Map<string, ScenarioRow>();
  const ticks = Array.from({ length: tickCount }, (_, tickIndex) => {
    const patches = Array.from(
      { length: patchesPerTick },
      (): DeterministicUpdatePatch => {
        const currentOrdinal = ordinal++;
        return stream.mode === "ripple"
          ? createRipplePatch(input.dataset.rows, stream, working, random)
          : createUniformCellPatch(
              input.dataset,
              input.seed,
              currentOrdinal,
              random,
            );
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
          rowGroups: Object.freeze(
            streamingGrouping.groupColumnIds.map((columnId) =>
              Object.freeze({ columnId }),
            ),
          ),
          aggregate: Object.freeze({
            columnId: streamingGrouping.aggregateColumnId,
            operation: "sum" as const,
          }),
          sort: Object.freeze([
            Object.freeze({
              columnId: streamingGrouping.aggregateColumnId,
              direction: "asc" as const,
            }),
          ]) as readonly [
            { readonly columnId: string; readonly direction: "asc" },
          ],
        })
      : null,
    rebuild: input.grouped
      ? Object.freeze({
          startAfterTick: 10 as const,
          sort: Object.freeze([
            Object.freeze({
              columnId: streamingGrouping.aggregateColumnId,
              direction: "desc" as const,
            }),
          ]) as readonly [
            { readonly columnId: string; readonly direction: "desc" },
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

function createUniformCellPatch(
  dataset: Pick<ScenarioDataset, "rows" | "columns">,
  seed: number,
  currentOrdinal: number,
  random: () => number,
): DeterministicUpdatePatch {
  const rowIndex = Math.floor(random() * dataset.rows.length);
  const columnIndex = Math.floor(random() * dataset.columns.length);
  const row = dataset.rows[rowIndex]!;
  const columnId = dataset.columns[columnIndex]!.id;
  const id = String(row.id ?? rowIndex);
  const value = createPatchValue(columnId, seed, currentOrdinal, random);
  return Object.freeze({
    id,
    columnId,
    value,
    changes: Object.freeze({ [columnId]: value }),
  });
}

/** Daily-vol-scale log-normal step: 0.2% per tick keeps prices positive and
 *  plausible across a 3 s run. */
const RIPPLE_SIGMA = 0.002;

function createRipplePatch(
  rows: readonly ScenarioRow[],
  stream: ScenarioPatchStreamRipple,
  working: Map<string, ScenarioRow>,
  random: () => number,
): DeterministicUpdatePatch {
  const rowIndex = Math.floor(random() * rows.length);
  const source = rows[rowIndex]!;
  const id = String(source.id ?? rowIndex);
  let row = working.get(id);
  if (row === undefined) {
    row = { ...source };
    working.set(id, row);
  }
  // Box–Muller; `1 - u1` keeps log() away from 0.
  const u1 = random();
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  const price =
    Math.round(
      Number(row[stream.tickColumnId]) * Math.exp(RIPPLE_SIGMA * z) * 100,
    ) / 100;
  row[stream.tickColumnId] = price;
  const derived = stream.derive(row);
  Object.assign(row, derived);
  const changes = Object.freeze({ [stream.tickColumnId]: price, ...derived });
  // columnId/value mirror the tick for single-cell readers; changes carries the ripple.
  return Object.freeze({
    id,
    columnId: stream.tickColumnId,
    value: price,
    changes,
  });
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
