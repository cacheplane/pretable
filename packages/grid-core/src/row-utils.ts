import type { PretableColumn, PretableGridOptions, PretableRow } from "./types";
import type { PretableSortEntry } from "./types";

/**
 * Row primitives shared by the filtering pipeline (`derived-rows.ts`) and the
 * grouping pipeline (`group-rows.ts`). They live here rather than in
 * `derived-rows.ts` so the two modules do not import each other — grouping runs
 * *inside* `deriveVisibleRows`, and a cycle between them would make module
 * evaluation order load-bearing.
 */

/** @internal */
export interface SourceRow<TRow extends PretableRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

/** @internal */
export function createSourceRows<TRow extends PretableRow>(
  options: PretableGridOptions<TRow>,
): SourceRow<TRow>[] {
  return options.rows.map((row, index) => ({
    id: options.getRowId(row),
    row,
    sourceIndex: index,
  }));
}

/**
 * Guard the one invariant every id-keyed subsystem rests on: identity comes
 * from the row, never from where the row sits. `getRowId` is a required field,
 * so this only fires for callers TypeScript cannot reach — plain JS, `any`, a
 * hand-built options object crossing a package boundary.
 *
 * @internal
 */
export function assertGetRowId<TRow extends PretableRow>(
  options: PretableGridOptions<TRow>,
): void {
  if (typeof options.getRowId !== "function") {
    throw new TypeError(
      "pretable: `getRowId` is required. Selection, focus, edits and " +
        "transactions are keyed by row id, so identity must come from the " +
        "row's own data — e.g. `getRowId: (row) => row.id`. There is no " +
        "positional default: one would silently re-point selection and " +
        "in-flight edits at the wrong rows whenever `rows` is replaced in a " +
        "different order.",
    );
  }
}

/** @internal */
export const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

type SortKey =
  | { kind: "num"; keys: number[]; multiplier: number }
  | { kind: "str"; keys: string[]; multiplier: number };

/**
 * Multi-key sort cascade with a `sourceIndex` tie-break. Grouping reuses this
 * so data rows inside a group are ordered exactly as they would be flat.
 *
 * @internal
 */
export function sortRows<TRow extends PretableRow>(
  rows: SourceRow<TRow>[],
  columns: PretableColumn<TRow>[],
  sort: readonly PretableSortEntry[],
): SourceRow<TRow>[] {
  // Precompute per-entry key arrays once — preserves the single-key perf shape.
  const keys = sort
    .map((entry): SortKey | null => {
      const column = columns.find((c) => c.id === entry.columnId);
      if (!column) return null;
      const rawKeys = rows.map((r) => readCellValue(r.row, column));
      const allNumeric = rawKeys.every((v) => typeof v === "number");
      const multiplier = entry.direction === "asc" ? 1 : -1;
      return allNumeric
        ? { kind: "num", keys: rawKeys as number[], multiplier }
        : {
            kind: "str",
            keys: rawKeys.map((v) => String(v ?? "")),
            multiplier,
          };
    })
    .filter((k): k is SortKey => k !== null);

  if (keys.length === 0) {
    return [...rows];
  }

  const indexed = rows.map((_, i) => i);
  indexed.sort((a, b) => {
    for (const key of keys) {
      const cmp =
        key.kind === "num"
          ? key.keys[a] - key.keys[b]
          : collator.compare(key.keys[a], key.keys[b]);
      if (cmp !== 0) {
        return cmp * key.multiplier;
      }
    }
    return rows[a].sourceIndex - rows[b].sourceIndex;
  });

  return indexed.map((i) => rows[i]);
}

/**
 * Read a column's value from a row — the single definition used by filtering,
 * sorting, grouping keys and aggregate inputs alike.
 *
 * @internal
 */
export function readCellValue<TRow extends PretableRow>(
  row: TRow,
  column: PretableColumn<TRow>,
): unknown {
  return column.value ? column.value(row) : row[column.id];
}
