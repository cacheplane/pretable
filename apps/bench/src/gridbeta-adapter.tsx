import { useRef } from "react";

import { useVirtualizer } from "@gridbeta/react-virtual";
import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

export interface GridBetaAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function GridBetaAdapter({ dataset, runKey }: GridBetaAdapterProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const displayRows = dataset.rows;
  const totalWidth = dataset.columns.reduce(
    (width, column) => width + (column.widthPx ?? 140),
    0,
  );
  const gridTemplateColumns = dataset.columns
    .map((column) => `${column.widthPx ?? 140}px`)
    .join(" ");
  // Bench-only adapter: this hook owns virtualization locally and does not
  // pass the returned functions through memoized boundaries.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      estimateRowHeight(displayRows[index], dataset.columns),
    overscan: 4,
  });

  return (
    <section
      aria-label="GridBeta Virtual adapter"
      data-benchmark-adapter="gridbeta"
      data-bench-result-row-count={String(displayRows.length)}
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
          GridBeta Virtual adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {displayRows.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {dataset.columns.length}
        </p>
      </header>

      <div
        key={runKey}
        ref={parentRef}
        className="adapter-surface"
        data-gridbeta-scroll-viewport=""
        style={{
          height: 320,
          minWidth: 720,
          overflow: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          position: "relative",
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            minWidth: totalWidth,
            position: "relative",
            width: totalWidth,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = displayRows[virtualRow.index];

            if (!row) {
              return null;
            }

            const estimatedHeight = estimateRowHeight(row, dataset.columns);

            return (
              <div
                key={`${runKey}-${String(row.id ?? virtualRow.key)}`}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                data-row-id={String(row.id ?? "")}
                data-row-height={estimatedHeight}
                data-row-index={virtualRow.index}
                data-gridbeta-row=""
                style={{
                  borderBottom: "1px solid rgb(210 217 224)",
                  boxSizing: "border-box",
                  display: "grid",
                  gap: 0,
                  gridTemplateColumns,
                  left: 0,
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                  width: totalWidth,
                }}
              >
                {dataset.columns.map((column) => (
                  <div
                    key={`${String(row.id)}-${column.id}`}
                    data-gridbeta-cell=""
                    style={{
                      borderRight: "1px solid rgb(229 233 237)",
                      overflowWrap: "anywhere",
                      padding: "8px 10px",
                      whiteSpace: column.wrap ? "normal" : "nowrap",
                    }}
                  >
                    {String(row[column.id] ?? "")}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function estimateRowHeight(
  row: ScenarioRow | undefined,
  columns: readonly ScenarioColumn[],
) {
  if (!row) {
    return 48;
  }

  const wrappedContentLength = columns.reduce((maxLength, column) => {
    if (!column.wrap) {
      return maxLength;
    }

    return Math.max(maxLength, String(row[column.id] ?? "").length);
  }, 0);

  const estimatedLines = Math.max(1, Math.ceil(wrappedContentLength / 32));

  return 20 + estimatedLines * 20;
}
