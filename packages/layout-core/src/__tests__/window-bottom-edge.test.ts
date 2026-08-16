import { describe, expect, test } from "vitest";

import { createRowHeightIndex } from "../row-height-index";
import { planViewport } from "../viewport-plan";

/**
 * The window's BOTTOM edge, and the trailing spacer past it.
 *
 * Every other windowed test drives the top of the window: `viewport-window`
 * plans at `scrollTop = leading` and just above it, `eviction-anchor` restores
 * an anchor into the leading region. `trailingHeight` reaches only one
 * assertion anywhere — `viewport-window`'s extent — and no test has ever put
 * the viewport past the last loaded row.
 *
 * That is the same shape of gap that let a whole conversion seam run at
 * `leadingHeight = 0`, where every conversion is an identity. So:
 *
 * - the trailing spacer is NONZERO and large (240 released rows), never the 0
 *   that makes `leading + loaded + trailing` agree with `leading + loaded`;
 * - the leading spacer is nonzero too, so a row's `top` cannot be right by
 *   forgetting it;
 * - row heights VARY (30..52, never repeating in step with anything), so an
 *   arithmetic mistake cannot land on a multiple of the row height and look
 *   right — the same reason `eviction-anchor.test.ts` uses this generator.
 */
const heightAt = (i: number) => 30 + ((i * 7) % 23);

const sumHeights = (from: number, to: number) => {
  let total = 0;
  for (let i = from; i < to; i += 1) total += heightAt(i);
  return total;
};

const buildIndex = (from: number, to: number) =>
  createRowHeightIndex({
    defaultHeight: 40,
    getKey: (key: number) => key,
    rows: Array.from({ length: to - from }, (_, n) => ({
      key: from + n,
      estimatedHeight: heightAt(from + n),
    })),
  });

const DATASET_ROWS = 400;
const WINDOW_START = 100;
const WINDOW_END = 160;
const WINDOW_ROWS = WINDOW_END - WINDOW_START;
const VIEWPORT = 400;

const LEADING = sumHeights(0, WINDOW_START);
const LOADED = sumHeights(WINDOW_START, WINDOW_END);
const TRAILING = sumHeights(WINDOW_END, DATASET_ROWS);

/** Where the trailing spacer begins, in the scroller's global coordinates. */
const WINDOW_BOTTOM = LEADING + LOADED;

/**
 * The window-LOCAL index covering `offset`, walked from the height generator
 * rather than asked of the row-height index — so an expectation and the thing
 * it is checking cannot be the same arithmetic.
 */
const localIndexAtOffset = (offset: number) => {
  let consumed = 0;
  for (let n = 0; n < WINDOW_ROWS; n += 1) {
    const next = consumed + heightAt(WINDOW_START + n);
    if (offset < next) return n;
    consumed = next;
  }
  return WINDOW_ROWS - 1;
};

const planAt = (scrollTop: number, overscan = 0) =>
  planViewport({
    scrollTop,
    viewportHeight: VIEWPORT,
    overscan,
    rowMetrics: buildIndex(WINDOW_START, WINDOW_END),
    leadingHeight: LEADING,
    trailingHeight: TRAILING,
  });

describe("the loaded window's bottom edge", () => {
  test("the fixture actually describes an eviction", () => {
    // Guards the fixture itself, not the planner. A trailing spacer of 0 or a
    // uniform height grid would let every assertion below pass for the wrong
    // reason, and neither would be visible in the failures.
    expect(TRAILING).toBeGreaterThan(0);
    expect(LEADING).toBeGreaterThan(0);
    expect(WINDOW_ROWS).toBeLessThan(DATASET_ROWS);
    // Varied, and not by a constant step: the heights inside the window take
    // more than one value, and the window's total is not a multiple of any of
    // them.
    const heights = new Set(
      Array.from({ length: WINDOW_ROWS }, (_, n) => heightAt(WINDOW_START + n)),
    );
    expect(heights.size).toBeGreaterThan(1);
    for (const height of heights) expect(LOADED % height).not.toBe(0);
  });

  test("the trailing spacer carries the extent past the last loaded row", () => {
    const plan = planAt(LEADING);
    expect(plan.totalHeight).toBe(sumHeights(0, DATASET_ROWS));
    expect(plan.totalHeight).toBe(LEADING + LOADED + TRAILING);

    // CONTROL: the same window with no trailing spacer stops at the last
    // loaded row, so the assertion above is about the spacer and not about
    // arithmetic that would hold either way.
    const withoutTrailing = planViewport({
      scrollTop: LEADING,
      viewportHeight: VIEWPORT,
      overscan: 0,
      rowMetrics: buildIndex(WINDOW_START, WINDOW_END),
      leadingHeight: LEADING,
    });
    expect(withoutTrailing.totalHeight).toBe(WINDOW_BOTTOM);
    expect(withoutTrailing.totalHeight).toBeLessThan(plan.totalHeight);
  });

  test("the window's last row ends exactly where the trailing spacer begins", () => {
    // The viewport's bottom flush with the window's bottom: the seam under
    // test is on screen, at the far end of 60 accumulated row heights.
    const scrollTop = WINDOW_BOTTOM - VIEWPORT;
    const plan = planAt(scrollTop);

    // The TOP of that viewport is an interior offset inside the window, and
    // pinning it is what makes this a bottom-edge test rather than a
    // saturation test: at the bottom edge every over-large local offset
    // resolves to the last row, so an implementation that never converted the
    // global scrollTop into the window at all would still name row 59.
    const expectedStart = localIndexAtOffset(LOADED - VIEWPORT);
    expect(expectedStart).toBeGreaterThan(0);
    expect(expectedStart).toBeLessThan(WINDOW_ROWS - 1);
    expect(plan.range.start).toBe(expectedStart);
    expect(plan.rows[0]?.top).toBe(
      LEADING + sumHeights(WINDOW_START, WINDOW_START + expectedStart),
    );
    // ...and that first row straddles the top of the viewport.
    expect(plan.rows[0]!.top).toBeLessThanOrEqual(scrollTop);
    expect(plan.rows[0]!.top + plan.rows[0]!.height).toBeGreaterThan(scrollTop);

    const last = plan.rows.at(-1);
    expect(last).toBeDefined();
    expect(last!.index).toBe(WINDOW_ROWS - 1);
    expect(plan.range.end).toBe(WINDOW_ROWS);
    // No gap and no overlap: the spacer starts where the row ends.
    expect(last!.top + last!.height).toBe(WINDOW_BOTTOM);
    expect(last!.top + last!.height).toBe(plan.totalHeight - TRAILING);
    // ...and that seam is where the user is looking — the bottom of the
    // viewport, not somewhere off screen.
    expect(last!.top + last!.height - scrollTop).toBe(VIEWPORT);
  });

  test("no row is ever laid out inside the trailing spacer", () => {
    // Parked well past the last loaded row: the viewport is over released
    // geometry, which is a region with no rows in it at all.
    const scrollTop = WINDOW_BOTTOM + 500;
    expect(scrollTop).toBeLessThan(LEADING + LOADED + TRAILING);

    // With NO overscan to pad it out: the window's last row is still planned,
    // and it is the only one. A planner that let the resolved index run off
    // the end of the loaded rows plans nothing here, which would unmount the
    // grid — and leave the row-height root with nothing to measure — the
    // moment the user scrolled one row past the window.
    const bare = planAt(scrollTop);
    expect(bare.rows.map((row) => row.index)).toEqual([WINDOW_ROWS - 1]);
    expect(bare.range).toEqual({ start: WINDOW_ROWS - 1, end: WINDOW_ROWS });

    const plan = planAt(scrollTop, 2);

    expect(plan.rows.length).toBeGreaterThan(0);
    for (const row of plan.rows) {
      expect(row.index).toBeGreaterThanOrEqual(0);
      expect(row.index).toBeLessThan(WINDOW_ROWS);
      // The invariant: the loaded rows occupy [leading, leading + loaded), and
      // nothing may be drawn past that into the spacer.
      expect(row.top).toBeGreaterThanOrEqual(LEADING);
      expect(row.top + row.height).toBeLessThanOrEqual(WINDOW_BOTTOM);
      // ...and every one of them is above the viewport, because the viewport
      // is in the spacer.
      expect(row.top + row.height).toBeLessThanOrEqual(scrollTop);
    }
    expect(plan.range.end).toBeLessThanOrEqual(WINDOW_ROWS);
  });

  test("the very bottom of the extent still resolves a real row", () => {
    // A scroller dragged to the end. `scrollTop` beyond the extent is clamped
    // into it, and what comes back has to be an index the loaded window
    // actually has — the last one, not `rowCount` and not a phantom.
    const plan = planAt(LEADING + LOADED + TRAILING + 10_000, 3);

    expect(plan.range.end).toBe(WINDOW_ROWS);
    const last = plan.rows.at(-1);
    expect(last).toBeDefined();
    expect(last!.index).toBe(WINDOW_ROWS - 1);
    expect(last!.height).toBe(heightAt(WINDOW_END - 1));
    expect(last!.top + last!.height).toBe(WINDOW_BOTTOM);
  });
});
