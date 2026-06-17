"use client";

import { PretableSurface } from "@pretable/react";
import { useMemo, useState } from "react";
import {
  LAYOUT_ROWS,
  type LayoutRow,
  makeLayoutColumns,
} from "./columnLayoutData";
import { useInView } from "./useInView";

const VIEWPORT_HEIGHT = 360;

export function ColumnLayoutGrid() {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <ColumnLayoutGridLive />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 44 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

function ColumnLayoutGridLive() {
  const columns = useMemo(() => makeLayoutColumns(), []);
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[13px] text-text-secondary">
          drag a column border to resize · drag a header to reorder
        </p>
        <button
          type="button"
          data-testid="reset-layout"
          onClick={() => setResetKey((k) => k + 1)}
          className="rounded-[6px] border border-rule px-3 py-1.5 font-mono text-[12px] text-text-primary hover:bg-bg-card"
        >
          Reset layout
        </button>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-rule">
        <PretableSurface<LayoutRow>
          key={resetKey}
          ariaLabel="Resizable, reorderable columns"
          columns={columns}
          getRowId={(row) => row.id}
          rows={LAYOUT_ROWS}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </>
  );
}
