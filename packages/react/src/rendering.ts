import type { PretableRow, PretableSortDirection } from "@pretable/core";
import type { PretableColumn } from "./types";

export const DEFAULT_ROW_HEIGHT = 44;
export const HEADER_HEIGHT = 52;

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
  return column.value ? column.value(row) : Reflect.get(row, column.id);
}

export function formatCellValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
