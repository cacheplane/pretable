"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo } from "react";

/**
 * Test fixture for `apps/website/e2e/grid-tab-wrap-rows.spec.ts`.
 *
 * `tabBehavior="wrap-rows"` was a WCAG 2.1.2 keyboard trap: it consumed Tab
 * and Shift+Tab unconditionally and clamped at the two corners, so 120
 * consecutive presses never left the grid in either engine. The fix was to
 * RELEASE at the corners. Every claim the docs make about that release — that
 * Tab eventually leaves forward, that Shift+Tab leaves backward, that a header
 * cell leaves in one press — is a claim about a real browser's sequential
 * focus order, and nothing on the docs site renders a `wrap-rows` grid to
 * drive it in one.
 *
 * jsdom cannot stand in. It has no sequential focus order at all: `Tab` is an
 * ordinary keydown there and nothing traverses unless a handler moves it by
 * hand, so `packages/react/src/__tests__/tab-behavior.test.tsx` can only assert
 * which presses the surface calls `preventDefault()` on. "Not prevented" and
 * "focus actually left the grid" are different statements, and only the second
 * one is the absence of a trap.
 *
 * ## Why it is laid out this way
 *
 * **Text inputs, not buttons, as the sentinels either side.** The exit tests
 * assert *which element* focus landed on, and a bare `<button>` cannot carry
 * that: macOS keeps bare buttons out of Safari's sequential tab order unless
 * Full Keyboard Access is on, while Playwright's Linux WebKit in CI includes
 * them — a button sentinel would pin somebody's operating system rather than
 * this grid (the same split that failed CI in
 * `grid-keyboard-a11y.spec.ts`). A text field is a tab stop in every engine
 * under every setting.
 *
 * **A landing element at all, rather than "focus is no longer in the grid".**
 * A tab walk wraps the document — WebKit laps a page several times in 30
 * presses — so a counter that only asks "outside yet?" cannot tell a
 * one-stop exit from a full lap back around. Naming the sentinel makes the
 * lap visible.
 *
 * **Three columns and four rows.** A wrap-rows exit costs up to rows ×
 * columns presses, so the shape is what makes the bound a number instead of
 * "eventually": 12 cells means the walk from the entry cell to the release
 * corner is exactly 12 presses, and a regression that clamps again cannot hide
 * inside a generous limit. It is deliberately not the 140-row demo grid the
 * keyboard docs use — that grid's corner is 1,000+ presses away, which is only
 * assertable as a timeout.
 *
 * **Every row is inside `viewportHeight`.** Each press of the walk moves the
 * focus address, and each move runs scroll-into-view; a shape taller than its
 * viewport would put a scroll and a re-render between consecutive presses for
 * no gain, since the corner release has nothing to do with virtualization.
 *
 * Deliberately not part of the product surface, and kept out of search engines:
 * `wrap-rows` is not the default and this page is not advice.
 */

interface WrapRow {
  id: string;
  alpha: string;
  bravo: string;
  charlie: number;
}

// The next two are the shape the spec's press counts are derived from — four
// rows by three columns — and the ids it addresses cells by. They are spelled
// out again there rather than imported: a Next page module may not export
// anything but its component and route config, so changing either here means
// changing the constants at the top of grid-tab-wrap-rows.spec.ts too.
const ROW_IDS = ["r1", "r2", "r3", "r4"] as const;

const COLUMNS: PretableColumn<WrapRow>[] = [
  { id: "alpha", header: "Alpha", widthPx: 120 },
  { id: "bravo", header: "Bravo", widthPx: 120 },
  { id: "charlie", header: "Charlie", type: "number", widthPx: 120 },
];

function makeRows(): WrapRow[] {
  return ROW_IDS.map((id, i) => ({
    id,
    alpha: `A${i + 1}`,
    bravo: i % 2 === 0 ? "West" : "East",
    charlie: (i + 1) * 7,
  }));
}

export default function TabWrapRowsFixturePage() {
  const rows = useMemo(() => makeRows(), []);
  const columns = useMemo(() => COLUMNS, []);
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>Tab wrap-rows fixture</h1>
      <p style={{ marginBottom: 12 }}>
        <label htmlFor="before-grid">Before the grid </label>
        <input id="before-grid" name="before-grid" type="text" />
      </p>
      <PretableSurface<WrapRow>
        ariaLabel="Tab wrap-rows fixture grid"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        tabBehavior="wrap-rows"
        viewportHeight={320}
      />
      <p style={{ marginTop: 12 }}>
        <label htmlFor="after-grid">After the grid </label>
        <input id="after-grid" name="after-grid" type="text" />
      </p>
    </main>
  );
}
