import { describe, expect, test } from "vitest";

import { createRowHeightIndex } from "../row-height-index";
import { planViewport } from "../viewport-plan";

/**
 * A 100,000-row dataset with rows 40,000..40,099 loaded. Everything outside
 * that window is pure geometry — no rows are materialized for it, so it
 * consumes no `aria-rowindex` and needs no focus/selection/copy exemptions,
 * which is what the no-placeholder-rows rule requires.
 */
const ROW_H = 40;
const WINDOW_START = 40_000;
const WINDOW_ROWS = 100;
const DATASET_ROWS = 100_000;

const loadedWindow = () =>
  createRowHeightIndex({
    defaultHeight: ROW_H,
    getKey: (key: number) => key,
    rows: Array.from({ length: WINDOW_ROWS }, (_, key) => ({
      key,
      estimatedHeight: ROW_H,
    })),
  });

const leading = WINDOW_START * ROW_H;
const trailing = (DATASET_ROWS - WINDOW_START - WINDOW_ROWS) * ROW_H;

const planAt = (scrollTop: number) =>
  planViewport({
    scrollTop,
    viewportHeight: 400,
    overscan: 0,
    rowMetrics: loadedWindow(),
    leadingHeight: leading,
    trailingHeight: trailing,
  });

describe("windowed viewport", () => {
  test("extent spans the dataset while only the window is materialized", () => {
    const plan = planAt(leading);
    expect(plan.totalHeight).toBe(DATASET_ROWS * ROW_H);
    expect(plan.rows.length).toBeLessThanOrEqual(WINDOW_ROWS);
  });

  test("the window's first row sits after the leading spacer", () => {
    const plan = planAt(leading);
    expect(plan.range.start).toBe(0);
    expect(plan.rows[0]?.top).toBe(leading);
    expect(plan.rows[0]?.index).toBe(0);
  });

  test("scrolling into the window resolves the right local row", () => {
    const plan = planAt(leading + 10 * ROW_H);
    expect(plan.range.start).toBe(10);
    expect(plan.rows[0]?.top).toBe(leading + 10 * ROW_H);
  });

  test("a local index maps back to its dataset index", () => {
    const plan = planAt(leading + 10 * ROW_H);
    expect(WINDOW_START + (plan.rows[0]?.index ?? -1)).toBe(40_010);
  });

  test("without spacers the planner is unchanged", () => {
    const plan = planViewport({
      scrollTop: 0,
      viewportHeight: 400,
      overscan: 0,
      rowMetrics: loadedWindow(),
    });
    expect(plan.totalHeight).toBe(WINDOW_ROWS * ROW_H);
    expect(plan.rows[0]?.top).toBe(0);
  });
});
