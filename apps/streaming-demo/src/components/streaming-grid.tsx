import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PretableGrid } from "@pretable/react";
import { PretableSurface } from "@pretable/react/internal";

import { streamingColumns } from "../columns";
import { formatChange, formatVolume } from "../format";
import type { StockRow } from "../types";

// Stable empty rows reference: PretableSurface internally uses
// `useMemo(() => createGrid({columns, rows, ...}), [columns, rows, ...])`,
// so passing a fresh `[]` on every render would recreate the grid and lose
// any rows we've added through applyTransaction. Use a module-level constant.
const EMPTY_ROWS: StockRow[] = [];

const getRowId = (row: StockRow) => row.id;

interface StreamingGridProps {
  /** Receives the grid instance once on mount. Engine drives via this. */
  onGridReady: (grid: PretableGrid<StockRow>) => void;
  /** Viewport height in pixels. Pretable surface needs this explicitly. */
  viewportHeight: number;
}

export function StreamingGrid({
  onGridReady,
  viewportHeight,
}: StreamingGridProps) {
  // Capture-once: the surface fires onGridReady on every render that creates a
  // new grid; we only want to forward the FIRST grid (since rows is stable,
  // this is also the only grid).
  const forwardedRef = useRef(false);
  const handleGridReady = useCallback(
    (grid: PretableGrid<StockRow>) => {
      if (forwardedRef.current) return;
      forwardedRef.current = true;
      onGridReady(grid);
    },
    [onGridReady],
  );

  const renderBodyCell = useCallback(
    (input: { column: { id: string }; row: StockRow }): ReactNode => {
      switch (input.column.id) {
        case "symbol":
          return <span className="cell-symbol">{input.row.symbol}</span>;
        case "name":
          return <span className="cell-name">{input.row.name}</span>;
        case "last":
          return (
            <span className="cell-numeric">{input.row.last.toFixed(2)}</span>
          );
        case "change_pct":
          return (
            <span
              className={
                input.row.change_pct >= 0
                  ? "cell-numeric cell-up"
                  : "cell-numeric cell-down"
              }
            >
              {formatChange(input.row.change_pct)}
            </span>
          );
        case "volume":
          return (
            <span className="cell-numeric">
              {formatVolume(input.row.volume)}
            </span>
          );
        case "sector":
          return <span className="cell-sector">{input.row.sector}</span>;
        case "last_update":
          return (
            <span className="cell-numeric cell-time">
              {input.row.last_update}
            </span>
          );
        default:
          return null;
      }
    },
    [],
  );

  return (
    <PretableSurface<StockRow>
      ariaLabel="Streaming demo grid"
      columns={streamingColumns}
      rows={EMPTY_ROWS}
      getRowId={getRowId}
      onGridReady={handleGridReady}
      renderBodyCell={renderBodyCell}
      viewportHeight={viewportHeight}
    />
  );
}
