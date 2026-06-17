"use client";

import { PretableSurface } from "@pretable/react";
import { useMemo } from "react";
import {
  type ScaleRow,
  TOTAL_CELLS,
  makeScaleColumns,
  makeScaleRows,
} from "./scaleData";
import { useInView } from "./useInView";
import { useRenderedCellCount } from "./useRenderedCellCount";

const VIEWPORT_HEIGHT = 420;

export function ScaleGrid() {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <ScaleGridLive />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 32 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

function ScaleGridLive() {
  const rows = useMemo(() => makeScaleRows(), []);
  const columns = useMemo(() => makeScaleColumns(), []);
  const { ref, count } = useRenderedCellCount();
  return (
    <>
      <p
        data-testid="scale-counter"
        className="mb-3 font-mono text-[13px] text-text-secondary"
      >
        <strong className="text-text-primary">
          {TOTAL_CELLS.toLocaleString("en-US")}
        </strong>{" "}
        cells in the model ·{" "}
        <strong className="text-accent" data-testid="scale-dom-count">
          {count.toLocaleString("en-US")}
        </strong>{" "}
        rendered in the DOM
      </p>
      <div ref={ref} className="overflow-hidden rounded-[8px] border border-rule">
        <PretableSurface<ScaleRow>
          ariaLabel="Virtualized 2,500 by 500 grid"
          columns={columns}
          getRowId={(row) => String(row.i)}
          rows={rows}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </>
  );
}
