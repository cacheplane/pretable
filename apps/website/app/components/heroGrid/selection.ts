import { GROUP_COLUMN_ID } from "@pretable/core";
import { ɵROW_SELECT_COLUMN_ID as ROW_SELECT_COLUMN_ID } from "@pretable/react";

// Both synthetic columns are presentation, and neither reaches the clipboard —
// mirroring `isSyntheticColumnId` in @pretable/react. Counting either here makes
// the sidebar claim a wider selection than ⌘C actually copies.
const isSynthetic = (id: string) =>
  id === ROW_SELECT_COLUMN_ID || id === GROUP_COLUMN_ID;
import type { PretableSelectionState } from "@pretable/core";

export interface SelectionSummary {
  rows: number;
  cols: number;
}

/**
 * Count distinct rows and columns touched by the selection ranges. Ranges are
 * given by boundary ids with everything between them implied, so they are only
 * meaningful against the order the grid is actually PAINTING.
 *
 * Both orders must therefore come from the engine — `grid.getState()
 * .columnLayout` and `snapshot.range(0, snapshot.visibleRowCount)` — never from
 * the `columns`/`rows` props.
 * Grouping makes them diverge outright (the derived group column is drawn and
 * is in no prop; a grouped column is in the prop and is not drawn), and so do
 * filtering and sorting on the row side. But the divergence starts before any
 * of that: the synthetic row-select column is drawn and is in no prop either,
 * and `selectAll`, `toggleRowSelection` and `setSelectAllVisible` all encode a
 * whole-row selection as drawn-first-id → drawn-last-id, which makes its id the
 * boundary of every full-row range.
 *
 * `columnOrder` is passed in whole, row-select column included, and the
 * geometry below is `serializeRanges`': the selector is dropped from the
 * countable columns, and a range boundary that IS the selector is a positional
 * "whole row" marker resolving to column 0 rather than an unresolvable id. That
 * keeps this label a true statement about the rectangle ⌘C copies, which is
 * what it claims to be.
 */
export function summarizeSelection(
  selection: PretableSelectionState,
  columnOrder: readonly string[],
  rowOrder: readonly string[],
): SelectionSummary | null {
  if (!selection.ranges.length) return null;
  const dataColumns = columnOrder.filter((id) => !isSynthetic(id));
  if (!dataColumns.length) return null;
  const rowIdx = new Map(rowOrder.map((id, i) => [id, i]));
  const colIdx = new Map(dataColumns.map((id, i) => [id, i]));
  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  for (const r of selection.ranges) {
    const r0 = rowIdx.get(r.startRowId),
      r1 = rowIdx.get(r.endRowId);
    if (r0 === undefined || r1 === undefined) continue;
    const startSynth = isSynthetic(r.startColumnId);
    const endSynth = isSynthetic(r.endColumnId);
    if (startSynth && endSynth) continue;
    const c0 = startSynth ? 0 : colIdx.get(r.startColumnId);
    const c1 = endSynth ? 0 : colIdx.get(r.endColumnId);
    if (c0 === undefined || c1 === undefined) continue;
    for (let i = Math.min(r0, r1); i <= Math.max(r0, r1); i += 1) rowSet.add(i);
    for (let j = Math.min(c0, c1); j <= Math.max(c0, c1); j += 1) colSet.add(j);
  }
  if (!rowSet.size || !colSet.size) return null;
  return { rows: rowSet.size, cols: colSet.size };
}
