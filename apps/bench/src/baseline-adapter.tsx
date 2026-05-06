import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;
const OVERSCAN = 4;

export interface BaselineAdapterProps {
  adapterId: "gridalpha" | "gridbeta" | "gridgamma";
  dataset: ScenarioDataset;
  label: string;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  runKey: number;
}

export function BaselineAdapter({
  adapterId,
  dataset,
  label,
  onUpdateApiReady,
  runKey,
}: BaselineAdapterProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);
  const [scrollTop, setScrollTop] = useState(0);
  const [displayRows, setDisplayRows] = useState<readonly ScenarioRow[]>(
    dataset.rows,
  );

  // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
  onUpdateApiReadyRef.current = onUpdateApiReady;

  useEffect(() => {
    setDisplayRows(dataset.rows);
    setScrollTop(0);
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: 0 });
    } else {
      viewport.scrollTop = 0;
    }
  }, [dataset.rows, runKey]);

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    displayRows.forEach((row, index) => {
      map.set(String(row.id ?? index), index);
    });
    return map;
  }, [displayRows]);

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setDisplayRows((prev) => {
        const next = prev.slice();
        for (const patch of patches) {
          const id = String(patch.id ?? "");
          const index = rowIndexById.get(id);
          if (index === undefined) continue;
          next[index] = { ...next[index], ...patch } as ScenarioRow;
        }
        return next;
      });
    };

    onUpdateApiReadyRef.current?.(apply);
  }, [rowIndexById, runKey]);

  const totalWidth = dataset.columns.reduce(
    (width, column) => width + (column.widthPx ?? 140),
    0,
  );
  const gridTemplateColumns = dataset.columns
    .map((column) => `${column.widthPx ?? 140}px`)
    .join(" ");
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const visibleRows = displayRows.slice(startIndex, startIndex + visibleCount);
  const totalHeight = displayRows.length * ROW_HEIGHT;

  return (
    <section
      aria-label={`${label} adapter`}
      data-benchmark-adapter={adapterId}
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
          {label} adapter
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
        ref={viewportRef}
        className="adapter-surface"
        data-scroll-viewport=""
        {...{ [`data-${adapterId}-scroll-viewport`]: "" }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        style={{
          height: VIEWPORT_HEIGHT,
          minWidth: 720,
          overflow: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          position: "relative",
        }}
      >
        <div
          style={{
            height: totalHeight,
            minWidth: totalWidth,
            position: "relative",
            width: totalWidth,
          }}
        >
          {visibleRows.map((row, offset) => {
            const rowIndex = startIndex + offset;

            return (
              <div
                key={`${runKey}-${String(row.id ?? rowIndex)}`}
                data-row-id={String(row.id ?? "")}
                data-row-height={ROW_HEIGHT}
                data-row-index={rowIndex}
                {...{ [`data-${adapterId}-row`]: "" }}
                style={{
                  borderBottom: "1px solid rgb(210 217 224)",
                  boxSizing: "border-box",
                  display: "grid",
                  gridTemplateColumns,
                  height: ROW_HEIGHT,
                  left: 0,
                  position: "absolute",
                  top: rowIndex * ROW_HEIGHT,
                  width: totalWidth,
                }}
              >
                {dataset.columns.map((column) => (
                  <BaselineCell
                    key={`${String(row.id ?? rowIndex)}-${column.id}`}
                    adapterId={adapterId}
                    column={column}
                    value={row[column.id]}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BaselineCell({
  adapterId,
  column,
  value,
}: {
  adapterId: BaselineAdapterProps["adapterId"];
  column: ScenarioColumn;
  value: unknown;
}) {
  return (
    <div
      {...{ [`data-${adapterId}-cell`]: "" }}
      style={{
        borderRight: "1px solid rgb(229 233 237)",
        boxSizing: "border-box",
        lineHeight: 1.35,
        overflow: "hidden",
        overflowWrap: "anywhere",
        padding: "8px 10px",
        whiteSpace: column.wrap ? "normal" : "nowrap",
      }}
    >
      {String(value ?? "")}
    </div>
  );
}
