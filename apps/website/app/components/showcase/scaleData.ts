import type { PretableColumn } from "@pretable/react";

export const ROW_COUNT = 2500;
export const COL_COUNT = 500;
export const TOTAL_CELLS = ROW_COUNT * COL_COUNT;

/** A row is just its index — cell values are derived lazily from (row, col). */
export interface ScaleRow {
  i: number;
}

export function makeScaleRows(): ScaleRow[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({ i }));
}

/** Deterministic synthetic value for a cell, in 0.0–99.9. */
export function synthCell(rowIndex: number, colIndex: number): number {
  return ((rowIndex * 31 + colIndex * 17) % 1000) / 10;
}

export function makeScaleColumns(): PretableColumn<ScaleRow>[] {
  const columns: PretableColumn<ScaleRow>[] = [
    {
      id: "row",
      header: "Row",
      widthPx: 76,
      pinned: "left",
      value: (row) => row.i,
      format: ({ value }) => `#${value as number}`,
    },
  ];
  for (let c = 0; c < COL_COUNT; c += 1) {
    const colIndex = c;
    columns.push({
      id: `c${c + 1}`,
      header: `C${c + 1}`,
      widthPx: 90,
      value: (row) => synthCell(row.i, colIndex),
      format: ({ value }) => (value as number).toFixed(1),
    });
  }
  return columns;
}
