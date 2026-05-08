import type {
  PretableCellRange,
  PretableColumn,
  PretableRow,
  PretableVisibleRow,
  PretableSelectionState,
} from "./types";

/**
 * Per-row selection state — "selected" means fully, "indeterminate" means partial.
 *
 * @public
 */
export type PretableRowSelectionTriState = "selected" | "indeterminate";

/** @internal */
export function rangeContainsCell(
  range: PretableCellRange,
  rowId: string,
  columnId: string,
  rowOrder: ReadonlyMap<string, number>,
  columnOrder: ReadonlyMap<string, number>,
): boolean {
  const rowIdx = rowOrder.get(rowId);
  const startRowIdx = rowOrder.get(range.startRowId);
  const endRowIdx = rowOrder.get(range.endRowId);
  const colIdx = columnOrder.get(columnId);
  const startColIdx = columnOrder.get(range.startColumnId);
  const endColIdx = columnOrder.get(range.endColumnId);

  if (
    rowIdx === undefined ||
    startRowIdx === undefined ||
    endRowIdx === undefined ||
    colIdx === undefined ||
    startColIdx === undefined ||
    endColIdx === undefined
  ) {
    return false;
  }

  const [rowLo, rowHi] =
    startRowIdx <= endRowIdx
      ? [startRowIdx, endRowIdx]
      : [endRowIdx, startRowIdx];
  const [colLo, colHi] =
    startColIdx <= endColIdx
      ? [startColIdx, endColIdx]
      : [endColIdx, startColIdx];

  return (
    rowIdx >= rowLo && rowIdx <= rowHi && colIdx >= colLo && colIdx <= colHi
  );
}

/** @internal */
export function deriveSelectedRows<TRow extends PretableRow>(args: {
  visibleRows: PretableVisibleRow<TRow>[];
  columns: PretableColumn<TRow>[];
  selection: PretableSelectionState;
}): Map<string, PretableRowSelectionTriState> {
  const { visibleRows, columns, selection } = args;
  const result = new Map<string, PretableRowSelectionTriState>();

  if (selection.ranges.length === 0 || columns.length === 0) {
    return result;
  }

  const rowOrder = new Map(visibleRows.map((r, i) => [r.id, i]));
  const columnOrder = new Map(columns.map((c, i) => [c.id, i]));

  for (const row of visibleRows) {
    let coveredCount = 0;

    for (const column of columns) {
      const inSome = selection.ranges.some((range) =>
        rangeContainsCell(range, row.id, column.id, rowOrder, columnOrder),
      );

      if (inSome) {
        coveredCount += 1;
      }
    }

    if (coveredCount === columns.length) {
      result.set(row.id, "selected");
    } else if (coveredCount > 0) {
      result.set(row.id, "indeterminate");
    }
  }

  return result;
}
