import {
  createGrid,
  type PretableColumn,
  type PretableRow,
} from "@pretable/core";
import { useMemo, useState } from "react";

import { measureRenderedRowHeight } from "./row-height";

export interface PretableProps<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn[];
  rows: TRow[];
}

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 44;
const OVERSCAN_ROWS = 6;
const ROW_LINE_HEIGHT = 22;
const ROW_BLOCK_PADDING = 20;
const HEADER_BLOCK_HEIGHT = 21;
const ROW_BORDER_HEIGHT = 1;
const ESTIMATED_CHARACTER_WIDTH = 10;

export function Pretable<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
}: PretableProps<TRow>) {
  const grid = createGrid({ columns, rows });
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<Record<number, number>>({});
  const rowHeights = useMemo(
    () =>
      rows.map(
        (row, rowIndex) =>
          measuredHeights[rowIndex] ?? estimateRowHeight(row, columns),
      ),
    [columns, measuredHeights, rows],
  );
  const rowOffsets = useMemo(() => {
    return rowHeights
      .reduce(
        (offsets, height) => [...offsets, (offsets.at(-1) ?? 0) + height],
        [0],
      )
      .slice(0, -1);
  }, [rowHeights]);
  const visibleStart = Math.max(
    0,
    findRowIndexForOffset(rowOffsets, rowHeights, scrollTop) - OVERSCAN_ROWS,
  );
  const visibleEnd = Math.min(
    rows.length,
    findRowIndexForOffset(
      rowOffsets,
      rowHeights,
      scrollTop + VIEWPORT_HEIGHT,
    ) +
      OVERSCAN_ROWS +
      1,
  );
  const visibleRows = useMemo(
    () =>
      rows.slice(visibleStart, visibleEnd).map((row, offset) => ({
        row,
        rowIndex: visibleStart + offset,
        top: rowOffsets[visibleStart + offset] ?? 0,
        height: rowHeights[visibleStart + offset] ?? ROW_HEIGHT,
      })),
    [rowHeights, rowOffsets, rows, visibleEnd, visibleStart],
  );
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0);
  const totalWidth = columns.reduce(
    (sum, column) => sum + getColumnWidth(column),
    0,
  );
  const captureMeasuredRow = (rowIndex: number, node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const measuredHeight = measureRenderedRowHeight(node);

    if (measuredHeight <= ROW_HEIGHT) {
      return;
    }

    setMeasuredHeights((current) => {
      if (current[rowIndex] === measuredHeight) {
        return current;
      }

      return {
        ...current,
        [rowIndex]: measuredHeight,
      };
    });
  };

  return (
    <section
      aria-label="Pretable React adapter"
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
          }}
        >
          Pretable React adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {grid.options.rows.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {grid.options.columns.length}
        </p>
      </header>

      <div
        aria-label="Pretable React adapter"
        data-pretable-scroll-viewport=""
        role="grid"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        style={{
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          height: VIEWPORT_HEIGHT,
          overflow: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          position: "relative",
        }}
      >
        <div
          data-pretable-scroll-content=""
          style={{
            height: Math.max(totalHeight, VIEWPORT_HEIGHT),
            minWidth: Math.max(totalWidth, 720),
            position: "relative",
          }}
        >
          {visibleRows.map(({ row, rowIndex, top, height }) => (
            <div
              key={String((row as { id?: unknown }).id ?? rowIndex)}
              aria-rowindex={rowIndex + 1}
              data-pretable-row=""
              data-row-height={height}
              data-row-index={rowIndex}
              data-testid="pretable-row"
              ref={(node) => {
                captureMeasuredRow(rowIndex, node);
              }}
              style={{
                alignItems: "start",
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                boxSizing: "border-box",
                display: "grid",
                gap: 12,
                gridTemplateColumns: columns
                  .map((column) => `${getColumnWidth(column)}px`)
                  .join(" "),
                height,
                insetInline: 0,
                padding: "10px 12px",
                position: "absolute",
                top,
              }}
            >
              {columns.map((column) => (
                <div key={column.id} data-pretable-cell="">
                  <strong
                    style={{
                      display: "block",
                      fontSize: 12,
                      lineHeight: "16px",
                      marginBottom: 4,
                      opacity: 0.7,
                    }}
                  >
                    {column.header ?? column.id}
                  </strong>
                  <span
                    style={{
                      display: "block",
                      lineHeight: `${ROW_LINE_HEIGHT}px`,
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                    }}
                  >
                    {String(row[column.id] ?? "")}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function estimateRowHeight(row: PretableRow, columns: PretableColumn[]) {
  let estimatedHeight = ROW_HEIGHT;

  for (const column of columns) {
    if (!column.wrap) {
      continue;
    }

    const content = String(row[column.id] ?? "");
    const lines = Math.max(
      1,
      Math.ceil(
        content.length /
          Math.max(
            16,
            Math.floor(getColumnWidth(column) / ESTIMATED_CHARACTER_WIDTH),
          ),
      ),
    );

    estimatedHeight = Math.max(
      estimatedHeight,
      lines * ROW_LINE_HEIGHT +
        HEADER_BLOCK_HEIGHT +
        ROW_BLOCK_PADDING +
        ROW_BORDER_HEIGHT,
    );
  }

  return estimatedHeight;
}

function findRowIndexForOffset(
  rowOffsets: number[],
  rowHeights: number[],
  offset: number,
) {
  let low = 0;
  let high = rowOffsets.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const rowTop = rowOffsets[middle] ?? 0;
    const rowBottom = rowTop + (rowHeights[middle] ?? ROW_HEIGHT);

    if (offset < rowTop) {
      high = middle - 1;
      continue;
    }

    if (offset >= rowBottom) {
      low = middle + 1;
      continue;
    }

    return middle;
  }

  return Math.min(rowOffsets.length, low);
}

function getColumnWidth(column: PretableColumn) {
  return column.widthPx ?? (column.wrap ? 220 : 140);
}
