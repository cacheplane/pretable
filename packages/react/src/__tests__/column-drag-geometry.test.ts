import { describe, expect, it } from "vitest";

import { computeColumnDropTarget } from "../column-drag-geometry";
import type { PlannedColumn } from "@pretable-internal/renderer-dom";

// Content-order layout, mirroring what planColumns produces:
// [left-pinned…][scrollable…][right-pinned…]. `left` is always the column's
// content offset; `right` is the sticky inset from the scrollport's right edge.
//
//   idx 0 "a"  pinned left   content 0…100
//   idx 1 "b"                content 100…300
//   idx 2 "c"                content 300…500
//   idx 3 "d"                content 500…700
//   idx 4 "z"  pinned right  content 700…800, right: 0
const LAYOUT: PlannedColumn[] = [
  { index: 0, id: "a", left: 0, width: 100, pinned: "left" },
  { index: 1, id: "b", left: 100, width: 200 },
  { index: 2, id: "c", left: 300, width: 200 },
  { index: 3, id: "d", left: 500, width: 200 },
  { index: 4, id: "z", left: 700, width: 100, pinned: "right", right: 0 },
];

const VIEWPORT_WIDTH = 400;
// The scrollport is not flush with the client origin: cursor x arrives in
// client coordinates and has to be rebased.
const VIEWPORT_LEFT = 50;

/** Drag "b" (engine index 1) unless a test says otherwise. */
function target(
  cursorInViewport: number,
  scrollLeft: number,
  draggedIndex = 1,
) {
  return computeColumnDropTarget({
    layout: LAYOUT,
    draggedIndex,
    cursorX: VIEWPORT_LEFT + cursorInViewport,
    viewportLeft: VIEWPORT_LEFT,
    viewportWidth: VIEWPORT_WIDTH,
    scrollLeft,
  });
}

describe("computeColumnDropTarget", () => {
  it("targets the column under the cursor when unscrolled", () => {
    // Viewport x 150 sits left of b's midpoint (200) → "b" is dropped back
    // where it started.
    expect(target(150, 0)).toEqual({ dropIndex: 1, indicatorLeft: 100 });
  });

  it("shifts the target by the horizontal scroll offset", () => {
    // At scrollLeft 300 the same physical point (viewport x 150) is over c,
    // left of d's visual midpoint (500 - 300 + 100 = 300) → drop before d.
    expect(target(150, 300)).toEqual({ dropIndex: 2, indicatorLeft: 500 });
  });

  it("keeps a left-pinned column's hit box under the sticky strip", () => {
    // "a" does not scroll away: viewport x 20 is still inside it, and the
    // indicator has to be drawn at the sticky strip's *content* position.
    expect(target(20, 300)).toEqual({ dropIndex: 0, indicatorLeft: 300 });
  });

  it("keeps a right-pinned column's hit box at the scrollport's right edge", () => {
    // "z" renders at viewport x 300…400 whatever the scroll offset is.
    // Viewport x 310 is left of its midpoint (350) → drop before "z", with the
    // indicator at content 300 + 300 = 600.
    expect(target(310, 300)).toEqual({ dropIndex: 3, indicatorLeft: 600 });
  });

  it("drops at the end when the cursor is past every midpoint", () => {
    // Past z's midpoint → the trailing edge of the last content column.
    expect(target(390, 300)).toEqual({ dropIndex: 4, indicatorLeft: 700 });
  });

  it("falls back to content coordinates for right pins when the scrollport is unmeasured", () => {
    // SSR / pre-layout: clientWidth is 0, so a right-pinned column has no
    // measured edge to stick to and sits at its content offset (700…800).
    expect(
      computeColumnDropTarget({
        layout: LAYOUT,
        draggedIndex: 1,
        cursorX: 710,
        viewportLeft: 0,
        viewportWidth: 0,
        scrollLeft: 0,
      }),
    ).toEqual({ dropIndex: 3, indicatorLeft: 700 });
  });

  it("returns a no-op target for an empty layout", () => {
    expect(
      computeColumnDropTarget({
        layout: [],
        draggedIndex: 0,
        cursorX: 100,
        viewportLeft: 0,
        viewportWidth: 400,
        scrollLeft: 0,
      }),
    ).toEqual({ dropIndex: 0, indicatorLeft: 0 });
  });

  // `dropIndex` is what grid.moveColumn takes, and moveColumn *removes the
  // column before inserting it* — so a rightward drag has to give back an
  // index one lower than the target's, or the column lands a slot past the
  // indicator.
  it("lands a rightward drag where the indicator showed", () => {
    // Drag "b" (1) onto d's left half: engine [a,b,c,d,z] → remove b →
    // [a,c,d,z] → insert at 2 → [a,c,b,d,z]. "b" ends up immediately before
    // "d", which is exactly the boundary the indicator marked.
    expect(target(550, 0)).toEqual({ dropIndex: 2, indicatorLeft: 500 });
  });

  it("lands a leftward drag where the indicator showed", () => {
    // Drag "d" (3) onto b's left half: remove d → [a,b,c,z] → insert at 1 →
    // [a,d,b,c,z], immediately before "b".
    expect(target(150, 0, 3)).toEqual({ dropIndex: 1, indicatorLeft: 100 });
  });

  it("treats the gap a column already occupies as a no-op", () => {
    // Drag "b" (1) onto c's left edge — the boundary "b" already sits at.
    // Insert index 1 is where it came from, so the engine short-circuits.
    // x is 299 rather than mid-column because the sticky "z" strip starts at
    // viewport 300 and claims everything past it.
    expect(target(299, 0)).toEqual({ dropIndex: 1, indicatorLeft: 300 });
  });

  it("gives a pinned strip the hit test for everything it covers", () => {
    // At scrollLeft 250 "d" renders at viewport 250…450 and the sticky "z"
    // paints over its tail at 300…400. Viewport x 320 is inside both; it is
    // left of d's midpoint (350) too, so a naive content-order walk would
    // resolve to a boundary the user cannot even see. What is on top wins.
    expect(target(320, 250)).toEqual({ dropIndex: 3, indicatorLeft: 550 });
  });
});
