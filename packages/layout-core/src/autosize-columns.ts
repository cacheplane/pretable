import type { AutosizeColumnsInput, AutosizeResult } from "./types";

const DEFAULT_MAX_WIDTH_PX = 400;
const DEFAULT_MIN_WIDTH_PX = 60;
const DEFAULT_AVERAGE_CHAR_WIDTH = 7;
const DEFAULT_CELL_PADDING_PX = 16;

export function autosizeColumns<
  TRow extends Record<string, unknown> = Record<string, unknown>,
>(input: AutosizeColumnsInput<TRow>): AutosizeResult {
  const maxWidthPx = input.options?.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX;
  const minWidthPx = input.options?.minWidthPx ?? DEFAULT_MIN_WIDTH_PX;
  const averageCharWidth =
    input.options?.averageCharWidth ?? DEFAULT_AVERAGE_CHAR_WIDTH;
  const cellPaddingPx = input.options?.cellPaddingPx ?? DEFAULT_CELL_PADDING_PX;
  const widths = new Map<string, number>();

  for (const column of input.columns) {
    if (column.widthPx !== undefined) {
      continue;
    }

    let maxContentWidth = 0;

    if (column.header) {
      const headerWidth =
        Array.from(column.header).length * averageCharWidth + cellPaddingPx;
      maxContentWidth = Math.max(maxContentWidth, headerWidth);
    }

    for (const row of input.rows) {
      const rawValue = column.getValue ? column.getValue(row) : row[column.id];
      const text = String(rawValue ?? "");

      if (text.length === 0) {
        continue;
      }

      const contentWidth =
        Array.from(text).length * averageCharWidth + cellPaddingPx;
      maxContentWidth = Math.max(maxContentWidth, contentWidth);
    }

    const clampedWidth = Math.max(
      minWidthPx,
      Math.min(maxWidthPx, maxContentWidth),
    );
    widths.set(column.id, clampedWidth);
  }

  return { widths };
}
