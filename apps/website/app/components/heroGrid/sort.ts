import type { PretableSortEntry } from "@pretable/react";

import type { PositionRow } from "./types";

const NUMERIC: ReadonlySet<string> = new Set([
  "qty",
  "last",
  "mktValue",
  "dayPnl",
  "dayPnlPct",
  "weight",
]);
const TEXT: ReadonlySet<string> = new Set(["symbol", "name", "sector"]);

function compareByColumn(
  a: PositionRow,
  b: PositionRow,
  columnId: string,
): number {
  if (NUMERIC.has(columnId)) {
    return (
      (a[columnId as keyof PositionRow] as number) -
      (b[columnId as keyof PositionRow] as number)
    );
  }
  if (TEXT.has(columnId)) {
    return String(a[columnId as keyof PositionRow]).localeCompare(
      String(b[columnId as keyof PositionRow]),
    );
  }
  return 0; // unknown / non-sortable: stable no-op
}

/** Default ordering when the user has not clicked a header: largest weight first. */
export function rankRows(rows: readonly PositionRow[]): PositionRow[] {
  return [...rows].sort((a, b) => b.weight - a.weight);
}

/**
 * Multi-key cascade over the ordered sort entries (index = priority).
 * `[]` falls back to the default weight ranking; entries on non-sortable
 * columns are skipped (a list of only those preserves the current order).
 * Ties across every key keep their input order (Array.prototype.sort is
 * stable).
 */
export function applySort(
  rows: readonly PositionRow[],
  sort: readonly PretableSortEntry[],
): PositionRow[] {
  if (sort.length === 0) return rankRows(rows);
  const keys = sort.filter(
    (entry) => NUMERIC.has(entry.columnId) || TEXT.has(entry.columnId),
  );
  if (keys.length === 0) {
    return [...rows]; // non-sortable columns only: preserve order
  }
  return [...rows].sort((a, b) => {
    for (const entry of keys) {
      const cmp = compareByColumn(a, b, entry.columnId);
      if (cmp !== 0) return entry.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}
