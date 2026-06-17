import type { PositionRow } from "./types";

export type ColumnId =
  | "symbol"
  | "name"
  | "sector"
  | "qty"
  | "last"
  | "mktValue"
  | "dayPnl"
  | "dayPnlPct"
  | "weight";

export type SortDirection = "asc" | "desc";
export interface SortState {
  columnId: ColumnId;
  direction: SortDirection;
}

const NUMERIC: ReadonlySet<ColumnId> = new Set([
  "qty",
  "last",
  "mktValue",
  "dayPnl",
  "dayPnlPct",
  "weight",
]);
const TEXT: ReadonlySet<ColumnId> = new Set(["symbol", "name", "sector"]);

function compareByColumn(
  a: PositionRow,
  b: PositionRow,
  columnId: ColumnId,
): number {
  if (NUMERIC.has(columnId)) {
    return (a[columnId] as number) - (b[columnId] as number);
  }
  if (TEXT.has(columnId)) {
    return String(a[columnId]).localeCompare(String(b[columnId]));
  }
  return 0; // unknown / non-sortable: stable no-op
}

/** Default ordering when the user has not clicked a header: largest weight first. */
export function rankRows(rows: readonly PositionRow[]): PositionRow[] {
  return [...rows].sort((a, b) => b.weight - a.weight);
}

export function applySort(
  rows: readonly PositionRow[],
  sort: SortState | null,
): PositionRow[] {
  if (sort === null) return rankRows(rows);
  if (!NUMERIC.has(sort.columnId) && !TEXT.has(sort.columnId)) {
    return [...rows]; // non-sortable column: preserve order
  }
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * compareByColumn(a, b, sort.columnId));
}
