"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo } from "react";

/**
 * Test fixture for `apps/website/e2e/grid-header-touch.spec.ts`.
 *
 * The header's three overlay controls — the 4px resize strip, the 18px filter
 * funnel and the 18px column menu — are the subject, and every claim about them
 * is a claim about pixels: how wide the tap target is once a transparent
 * `::after` is counted, whether a control is hit-testable at all, and whether
 * any of it changes the header's own box. jsdom can make none of those claims
 * (it refuses `getComputedStyle` with pseudo-elements outright and lays nothing
 * out), so they are measured here with `document.elementFromPoint`.
 *
 * ## Why a fixture rather than an existing route
 *
 * The measurement is a hit-test sweep at 1px steps around each control, so
 * every control under test has to be inside the viewport at an iPhone 13's
 * 390px — and the controls sit on each column's TRAILING edge. `/fixtures/
 * grouping` puts its first trailing edge past 390px once the group column and
 * the row-select column are in front of it, which would make the sweep measure
 * whatever the scrollport clipped rather than the control.
 *
 * Three 96px columns keep all three trailing edges on screen with room to
 * spare, and the two grids differ in exactly one prop:
 *
 * - `#with-panel` enables the group panel, so `showColumnMenu` is true and the
 *   header carries all THREE controls. That is the case the funnel measures
 *   ~17px wide in today, because the menu button paints above its hit area.
 * - `#no-panel` has no group panel, so it carries the common TWO — strip and
 *   funnel — which is what most grids ship.
 *
 * Density is not a prop here: the spec sets `data-density` on `<html>` in an
 * init script so the value is in place before the surface's first measuring
 * render, which is what `getDensityHeights` reads.
 *
 * Deliberately not part of the product surface. Kept out of search engines so
 * the fixture can stay optimized for browser-level geometry assertions.
 */

interface HeaderTouchRow {
  id: string;
  alpha: string;
  bravo: string;
  charlie: number;
}

/**
 * `charlie` is `filterable: false` on purpose, and it is the only column that
 * is. With the group panel on it therefore carries a column menu and NO funnel
 * — the one branch of the slot arithmetic in `pretable-surface.tsx` where the
 * menu takes the funnel's own slot rather than its own, and the one nothing
 * else in the suite reaches. `alpha` and `bravo` keep the ordinary pair.
 */
const COLUMNS: PretableColumn<HeaderTouchRow>[] = [
  { id: "alpha", header: "Alpha", widthPx: 96 },
  { id: "bravo", header: "Bravo", widthPx: 96 },
  {
    id: "charlie",
    header: "Charlie",
    type: "number",
    widthPx: 96,
    filterable: false,
  },
];

function makeRows(): HeaderTouchRow[] {
  return Array.from({ length: 24 }, (_, i) => ({
    id: `r${i}`,
    alpha: `A${i}`,
    bravo: i % 2 === 0 ? "West" : "East",
    charlie: i * 3,
  }));
}

export default function HeaderTouchFixturePage() {
  const rows = useMemo(() => makeRows(), []);
  const columns = useMemo(() => COLUMNS, []);
  return (
    <main style={{ padding: 8 }}>
      <h1 style={{ fontSize: 16, marginBottom: 8 }}>Header touch fixture</h1>
      <section id="with-panel" style={{ marginBottom: 16 }}>
        <PretableSurface<HeaderTouchRow>
          ariaLabel="Header controls with group panel"
          columns={columns}
          getRowId={(row) => row.id}
          groupPanel={{ enabled: true }}
          rows={rows}
          viewportHeight={180}
        />
      </section>
      <section id="no-panel">
        <PretableSurface<HeaderTouchRow>
          ariaLabel="Header controls without group panel"
          columns={columns}
          getRowId={(row) => row.id}
          rows={rows}
          viewportHeight={180}
        />
      </section>
    </main>
  );
}
