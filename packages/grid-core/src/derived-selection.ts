import type {
  GridCoreCellRange,
  GridCoreColumn,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
} from "./types";

export type RowSelectionTriState = "selected" | "indeterminate";

export function rangeContainsCell(
  range: GridCoreCellRange,
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
    rowIdx >= rowLo &&
    rowIdx <= rowHi &&
    colIdx >= colLo &&
    colIdx <= colHi
  );
}

export function deriveSelectedRows<TRow extends GridCoreRow>(args: {
  visibleRows: GridCoreRowModel<TRow>[];
  columns: GridCoreColumn<TRow>[];
  selection: GridCoreSelectionState;
}): Map<string, RowSelectionTriState> {
  const { visibleRows, columns, selection } = args;
  const result = new Map<string, RowSelectionTriState>();

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
