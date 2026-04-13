import type {
  PretableColumn,
  PretableRow,
  PretableSortDirection,
} from "@pretable/core";

export const DEFAULT_ROW_HEIGHT = 44;
export const DEFAULT_WRAPPED_COLUMN_WIDTH = 220;
export const DEFAULT_FIXED_COLUMN_WIDTH = 140;
export const HEADER_HEIGHT = 52;

export function getColumnWidth<TRow extends PretableRow = PretableRow>(
  column: PretableColumn<TRow>,
) {
  return column.widthPx ?? (column.wrap ? DEFAULT_WRAPPED_COLUMN_WIDTH : DEFAULT_FIXED_COLUMN_WIDTH);
}

export function getPinnedLeftOffsets<TRow extends PretableRow = PretableRow>(
  columns: PretableColumn<TRow>[],
) {
  const offsets: Record<string, number> = {};
  let left = 0;

  for (const column of columns) {
    if (column.pinned !== "left") {
      continue;
    }

    offsets[column.id] = left;
    left += getColumnWidth(column);
  }

  return offsets;
}

export function getNextSortDirection(current: PretableSortDirection) {
  if (current === null) {
    return "desc";
  }

  if (current === "desc") {
    return "asc";
  }

  return null;
}

export function resolveCellValue<TRow extends PretableRow = PretableRow>(
  row: TRow,
  column: PretableColumn<TRow>,
) {
  return column.getValue ? column.getValue(row) : row[column.id];
}

export function formatCellValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
