import type { ColumnType } from "@pretable/core";

export type ColumnAlign = "start" | "center" | "end";

/**
 * A column's effective alignment. Numbers align to the trailing edge so digits
 * of differing magnitude line up; everything else follows the writing
 * direction, which is the browser default and needs no attribute.
 *
 * Returning `undefined` rather than `"start"` for the default keeps the
 * attribute off the overwhelming majority of cells — one fewer string written
 * per cell per render across a virtualized grid.
 */
export function resolveColumnAlign(column: {
  align?: ColumnAlign;
  type?: ColumnType;
}): ColumnAlign | undefined {
  if (column.align) return column.align;
  return column.type === "number" ? "end" : undefined;
}
