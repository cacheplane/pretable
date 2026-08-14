"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo, useState } from "react";

interface Row {
  id: string;
  name: string;
  qty: number;
}

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 200 },
  { id: "qty", header: "Qty", type: "number", widthPx: 120 },
];

/**
 * Two grids, identical apart from where they sit: one inside a
 * `data-density="compact"` wrapper, one outside it. A single read of
 * `document.documentElement` gives both the same geometry by construction, so
 * the pair cannot agree by accident.
 *
 * The remount button is the instrument for the no-flash assertion. On a warm
 * localhost load the whole of hydration lands inside one frame, so the initial
 * paint cannot distinguish "corrected before paint" from "corrected right
 * after" — nothing was on screen either way. Remounting the grids from a click,
 * long after the page is idle, puts a mount commit in the middle of a normal
 * frame cadence where the difference is observable: without the layout-effect
 * correction the first commit paints the ROOT's geometry and the passive
 * snapshot check replaces it a frame later.
 */
export function DensityScopeGrids() {
  const [generation, setGeneration] = useState(0);
  const rows = useMemo<Row[]>(
    () =>
      Array.from({ length: 400 }, (_, index) => ({
        id: `r${index + 1}`,
        name: `Item ${index + 1}`,
        qty: (index + 1) * 10,
      })),
    [],
  );
  const columns = useMemo(() => COLUMNS, []);

  return (
    <>
      <button
        data-testid="remount"
        onClick={() => setGeneration((value) => value + 1)}
        type="button"
      >
        Remount grids
      </button>
      <div data-density="compact" data-testid="scoped">
        <PretableSurface<Row>
          ariaLabel="Wrapper-scoped density grid"
          columns={columns}
          getRowId={(row) => row.id}
          key={generation}
          rows={rows}
          viewportHeight={300}
        />
      </div>
      <div data-testid="unscoped">
        <PretableSurface<Row>
          ariaLabel="Root density grid"
          columns={columns}
          getRowId={(row) => row.id}
          key={generation}
          rows={rows}
          viewportHeight={300}
        />
      </div>
    </>
  );
}
