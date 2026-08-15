import { describe, expect, test } from "vitest";

import { createRowHeightIndex } from "../row-height-index";
import { planViewport } from "../viewport-plan";

/**
 * Does viewport anchoring survive an EVICTION-sized geometry change?
 *
 * Anchoring is proven for cooperative rebuilds, where the row set is stable
 * and heights are corrected. Eviction is a different magnitude: a whole
 * leading region stops existing as rows and becomes spacer geometry, so every
 * surviving row's local index shifts and the extent is rebuilt from a
 * different basis.
 *
 * The claim under test: a row the user is looking at stays visually put
 * across that change.
 */

// Deliberately varied heights — a uniform grid would let a wrong answer look
// right, because every arithmetic mistake lands on a multiple of the row height.
const heightAt = (i: number) => 30 + ((i * 7) % 23);

const buildIndex = (from: number, to: number) =>
  createRowHeightIndex({
    defaultHeight: 40,
    getKey: (key: number) => key,
    rows: Array.from({ length: to - from }, (_, n) => ({
      key: from + n,
      estimatedHeight: heightAt(from + n),
    })),
  });

const sumHeights = (from: number, to: number) => {
  let total = 0;
  for (let i = from; i < to; i += 1) total += heightAt(i);
  return total;
};

const VIEWPORT = 400;
const TOTAL_ROWS = 200;
const EVICT_BEFORE = 100; // rows 0..99 are released

describe("anchoring across eviction", () => {
  test("the anchored row keeps its on-screen position when the leading region is evicted", () => {
    const before = buildIndex(0, TOTAL_ROWS);

    // Look at row 150, scrolled so it sits partway down the viewport.
    const anchorRow = 150;
    const scrollTop = before.getOffsetForIndex(anchorRow) - 120;
    const planBefore = planViewport({
      scrollTop,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: before,
    });
    const topBefore = planBefore.rows.find((r) => r.index === anchorRow)?.top;
    expect(topBefore).toBeDefined();
    // Where the row sits ON SCREEN — the thing that must not move.
    const screenYBefore = topBefore! - scrollTop;

    const anchor = before.captureAnchor(anchorRow, scrollTop);
    expect(anchor).toBeDefined();

    // --- EVICT rows 0..99. They become spacer geometry, not rows. ---
    const after = buildIndex(EVICT_BEFORE, TOTAL_ROWS);
    // The evicted rows were never measured, so the spacer is an ESTIMATE.
    // This is the case anchoring exists for: exact heights move nothing.
    const leading = Math.round(sumHeights(0, EVICT_BEFORE) * 1.05);
    const localIndex = anchorRow - EVICT_BEFORE;

    // Restore: the index returns a window-local scrollTop, so the caller adds
    // the spacer to get back into global coordinates.
    const restored = leading + after.restoreAnchor(anchor!, localIndex);

    const planAfter = planViewport({
      scrollTop: restored,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: after,
      leadingHeight: leading,
    });
    const topAfter = planAfter.rows.find((r) => r.index === localIndex)?.top;
    expect(topAfter).toBeDefined();
    const screenYAfter = topAfter! - restored;

    // THE CLAIM: the row did not move on screen.
    expect(screenYAfter).toBeCloseTo(screenYBefore, 5);
  });

  test("the extent is unchanged by eviction, so the scrollbar does not jump", () => {
    const before = buildIndex(0, TOTAL_ROWS);
    const extentBefore = planViewport({
      scrollTop: 0,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: before,
    }).totalHeight;

    const after = buildIndex(EVICT_BEFORE, TOTAL_ROWS);
    const extentAfter = planViewport({
      scrollTop: 0,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: after,
      leadingHeight: sumHeights(0, EVICT_BEFORE),
    }).totalHeight;

    expect(extentAfter).toBe(extentBefore);
  });

  test("CONTROL: without the spacer the extent collapses — proving the assertions above are not vacuous", () => {
    const before = buildIndex(0, TOTAL_ROWS);
    const extentBefore = planViewport({
      scrollTop: 0,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: before,
    }).totalHeight;

    const after = buildIndex(EVICT_BEFORE, TOTAL_ROWS);
    const extentNoSpacer = planViewport({
      scrollTop: 0,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: after,
    }).totalHeight;

    expect(extentNoSpacer).toBeLessThan(extentBefore);
  });
});
