import {
  type PretableColumn,
  type PretableRow,
} from "@pretable/core";
import { createDomRenderSnapshot } from "@pretable-internal/renderer-dom";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { measureRenderedRowHeight } from "./row-height";
import { usePretable } from "./use-pretable";

export interface PretableProps<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
}

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 44;
const OVERSCAN_ROWS = 6;

export function Pretable<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
}: PretableProps<TRow>) {
  const grid = usePretable({ columns, rows });
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>(
    {},
  );
  const renderSnapshot = useMemo(
    () =>
      createDomRenderSnapshot({
        columns: grid.options.columns,
        snapshot,
        scrollTop: snapshot.viewport.scrollTop,
        viewportHeight: VIEWPORT_HEIGHT,
        overscan: OVERSCAN_ROWS,
        measuredHeights,
      }),
    [grid.options.columns, measuredHeights, snapshot],
  );
  const captureMeasuredRow = (rowId: string, node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const measuredHeight = measureRenderedRowHeight(node);

    if (measuredHeight <= ROW_HEIGHT) {
      return;
    }

    setMeasuredHeights((current) => {
      if (current[rowId] === measuredHeight) {
        return current;
      }

      return {
        ...current,
        [rowId]: measuredHeight,
      };
    });
  };

  useEffect(() => {
    if (snapshot.viewport.height === VIEWPORT_HEIGHT) {
      return;
    }

    grid.setViewport({
      scrollTop: snapshot.viewport.scrollTop,
      height: VIEWPORT_HEIGHT,
    });
  }, [grid, snapshot.viewport.height, snapshot.viewport.scrollTop]);

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
          Rows: {snapshot.totalRowCount}
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
          grid.setViewport({
            scrollTop: event.currentTarget.scrollTop,
            height: VIEWPORT_HEIGHT,
          });
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
            height: Math.max(renderSnapshot.totalHeight, VIEWPORT_HEIGHT),
            minWidth: Math.max(renderSnapshot.totalWidth, 720),
            position: "relative",
          }}
        >
          {renderSnapshot.rows.map(({ id, row, rowIndex, top, height }) => (
            <div
              key={id}
              aria-rowindex={rowIndex + 1}
              data-pretable-row=""
              data-row-height={height}
              data-row-index={rowIndex}
              data-testid="pretable-row"
              ref={(node) => {
                captureMeasuredRow(id, node);
              }}
              style={{
                alignItems: "start",
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                boxSizing: "border-box",
                display: "grid",
                gap: 12,
                gridTemplateColumns: grid.options.columns
                  .map((column) => `${column.widthPx ?? (column.wrap ? 220 : 140)}px`)
                  .join(" "),
                height,
                insetInline: 0,
                padding: "10px 12px",
                position: "absolute",
                top,
              }}
            >
              {grid.options.columns.map((column) => (
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
                      lineHeight: "22px",
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
