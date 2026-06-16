import type { PretableSelectionState } from "@pretable/core";

export interface SelectionSummary {
  rows: number;
  cols: number;
}

/**
 * Count distinct rows and columns touched by the selection ranges. Ranges are
 * given by boundary ids; we resolve them against the visible orders to expand.
 */
export function summarizeSelection(
  selection: PretableSelectionState,
  columnOrder: readonly string[],
  rowOrder: readonly string[],
): SelectionSummary | null {
  if (!selection.ranges.length) return null;
  const rowIdx = new Map(rowOrder.map((id, i) => [id, i]));
  const colIdx = new Map(columnOrder.map((id, i) => [id, i]));
  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  for (const r of selection.ranges) {
    const r0 = rowIdx.get(r.startRowId), r1 = rowIdx.get(r.endRowId);
    const c0 = colIdx.get(r.startColumnId), c1 = colIdx.get(r.endColumnId);
    if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined) continue;
    for (let i = Math.min(r0, r1); i <= Math.max(r0, r1); i += 1) rowSet.add(i);
    for (let j = Math.min(c0, c1); j <= Math.max(c0, c1); j += 1) colSet.add(j);
  }
  if (!rowSet.size || !colSet.size) return null;
  return { rows: rowSet.size, cols: colSet.size };
}
