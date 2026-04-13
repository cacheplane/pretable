import { describe, expect, test } from "vitest";

import { createRowMetricsIndex, planViewport } from "../index";

describe("layout-core", () => {
  test("row-height prefix sums map row index to offset and offset to row index", () => {
    const rowMetrics = createRowMetricsIndex([40, 50, 60]);

    expect(rowMetrics.getOffsetForIndex(0)).toBe(0);
    expect(rowMetrics.getOffsetForIndex(1)).toBe(40);
    expect(rowMetrics.getOffsetForIndex(2)).toBe(90);
    expect(rowMetrics.getOffsetForIndex(3)).toBe(150);

    expect(rowMetrics.getIndexForOffset(0)).toBe(0);
    expect(rowMetrics.getIndexForOffset(39)).toBe(0);
    expect(rowMetrics.getIndexForOffset(40)).toBe(1);
    expect(rowMetrics.getIndexForOffset(89)).toBe(1);
    expect(rowMetrics.getIndexForOffset(90)).toBe(2);
    expect(rowMetrics.getIndexForOffset(149)).toBe(2);
    expect(rowMetrics.getIndexForOffset(150)).toBe(3);
  });

  test("height corrections update later offsets without changing unrelated earlier offsets", () => {
    const rowMetrics = createRowMetricsIndex([40, 50, 60, 70]);

    rowMetrics.updateHeight(1, 80);

    expect(rowMetrics.getOffsetForIndex(0)).toBe(0);
    expect(rowMetrics.getOffsetForIndex(1)).toBe(40);
    expect(rowMetrics.getOffsetForIndex(2)).toBe(120);
    expect(rowMetrics.getOffsetForIndex(3)).toBe(180);
    expect(rowMetrics.getTotalHeight()).toBe(250);
  });

  test("viewport extraction returns a stable overscanned row range", () => {
    const rowMetrics = createRowMetricsIndex([40, 50, 60, 70, 80, 90, 100]);

    const plan = planViewport({
      scrollTop: 95,
      viewportHeight: 120,
      overscan: 1,
      rowMetrics,
    });

    expect(plan.range).toEqual({ start: 1, end: 5 });
    expect(plan.rows.map((row) => row.index)).toEqual([1, 2, 3, 4]);
    expect(plan.rows.map((row) => row.top)).toEqual([40, 90, 150, 220]);
    expect(plan.totalHeight).toBe(490);
  });

  test("pinned-column metadata survives viewport planning without mutating row math", () => {
    const rowMetrics = createRowMetricsIndex([40, 50, 60, 70]);
    const offsetBefore = rowMetrics.getOffsetForIndex(2);

    const plan = planViewport({
      scrollTop: 0,
      viewportHeight: 120,
      overscan: 0,
      rowMetrics,
      pinnedLeft: [
        { columnId: "timestamp", width: 120 },
        { columnId: "severity", width: 90 },
      ],
      pinnedRight: [{ columnId: "owner", width: 140 }],
    });

    expect(plan.pinned.left).toEqual([
      { columnId: "timestamp", side: "left", start: 0, end: 120, width: 120 },
      { columnId: "severity", side: "left", start: 120, end: 210, width: 90 },
    ]);
    expect(plan.pinned.right).toEqual([
      { columnId: "owner", side: "right", start: 0, end: 140, width: 140 },
    ]);
    expect(rowMetrics.getOffsetForIndex(2)).toBe(offsetBefore);
  });
});
