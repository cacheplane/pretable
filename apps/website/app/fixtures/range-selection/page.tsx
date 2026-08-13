"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo } from "react";

/**
 * Test fixture for `apps/website/e2e/range-selection.spec.ts`.
 *
 * Marquee cell-range selection ("Drag (pointer down -> enter cells -> up)"
 * in content/docs/grid/selection.mdx) can only be proven under real pointer
 * capture. The anchor cell calls `setPointerCapture` on `pointerdown`, and
 * per the Pointer Events spec that retargets every subsequent pointer event
 * to it — regardless of where the cursor physically is. jsdom does not
 * implement capture retargeting at all, so the unit suite cannot see whether
 * a drag actually grows the range past its start cell; it can only fire
 * `pointerEnter` directly on a target cell, which is not what a real drag
 * delivers. See `packages/react/src/marquee-drag.ts` for the full story and
 * `packages/react/src/__tests__/row-activation.test.tsx` for what the jsdom
 * suite can and cannot see about this gesture.
 *
 * A plain, ungrouped grid with no row-selection column: the drag targets
 * ordinary data cells addressed by (rowId, columnId), so nothing about
 * grouping or the synthetic checkbox column needs to be threaded through the
 * assertions.
 *
 * Deliberately not part of the product surface. Kept out of search engines so
 * the fixture can stay optimized for browser-level pointer assertions.
 */

interface Row {
  id: string;
  name: string;
  qty: number;
  status: string;
}

const ROW_COUNT = 12;

function makeRows(): Row[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `r${i + 1}`,
    name: `Item ${i + 1}`,
    qty: (i + 1) * 10,
    status: i % 2 === 0 ? "Active" : "Idle",
  }));
}

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 160 },
  { id: "qty", header: "Qty", type: "number", widthPx: 100 },
  { id: "status", header: "Status", widthPx: 120 },
];

export default function RangeSelectionFixturePage() {
  const rows = useMemo(() => makeRows(), []);
  const columns = useMemo(() => COLUMNS, []);
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>Range selection fixture</h1>
      <PretableSurface<Row>
        ariaLabel="Range selection fixture grid"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={400}
      />
    </main>
  );
}
