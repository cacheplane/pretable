import { describe, expect, test } from "vitest";

import { createRowMetricsIndex, planColumns, planViewport } from "../index";

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

describe("planColumns", () => {
  const columns = Array.from({ length: 20 }, (_, i) => ({
    id: `col_${i}`,
    width: 140,
  }));

  test("returns only the columns visible in the viewport plus overscan", () => {
    const plan = planColumns({
      columns,
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 1,
    });

    // 400px viewport / 140px cols = ~3 visible columns, +1 overscan on right
    expect(plan.columns.length).toBeLessThan(20);
    expect(plan.columns.length).toBeGreaterThanOrEqual(3);
    expect(plan.columns.every((c) => c.left >= 0)).toBe(true);
    expect(plan.totalWidth).toBe(20 * 140);
    expect(plan.pinnedLeftWidth).toBe(0);
  });

  test("includes pinned columns regardless of scrollLeft", () => {
    const columnsWithPinned = [
      { id: "pinned_0", width: 100, pinned: "left" as const },
      { id: "pinned_1", width: 120, pinned: "left" as const },
      ...columns,
    ];

    const plan = planColumns({
      columns: columnsWithPinned,
      scrollLeft: 2000,
      viewportWidth: 400,
      overscan: 1,
    });

    const pinnedIds = plan.columns
      .filter((c) => c.pinned === "left")
      .map((c) => c.id);

    expect(pinnedIds).toEqual(["pinned_0", "pinned_1"]);
    expect(plan.pinnedLeftWidth).toBe(220);
  });

  test("returns correct absolute left offsets for visible columns", () => {
    const plan = planColumns({
      columns,
      scrollLeft: 280,
      viewportWidth: 400,
      overscan: 0,
    });

    for (const col of plan.columns) {
      expect(col.left).toBe(col.index * 140);
    }
  });

  test("handles scrollLeft at the rightmost edge", () => {
    const totalWidth = 20 * 140;
    const plan = planColumns({
      columns,
      scrollLeft: totalWidth - 400,
      viewportWidth: 400,
      overscan: 1,
    });

    const lastCol = plan.columns[plan.columns.length - 1];
    expect(lastCol?.id).toBe("col_19");
    expect(plan.columns.length).toBeGreaterThanOrEqual(3);
  });

  test("returns all columns when they fit within the viewport", () => {
    const smallColumns = [
      { id: "a", width: 100 },
      { id: "b", width: 100 },
      { id: "c", width: 100 },
    ];

    const plan = planColumns({
      columns: smallColumns,
      scrollLeft: 0,
      viewportWidth: 1440,
      overscan: 6,
    });

    expect(plan.columns).toHaveLength(3);
    expect(plan.totalWidth).toBe(300);
  });

  test("returns empty columns for an empty input", () => {
    const plan = planColumns({
      columns: [],
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 6,
    });

    expect(plan.columns).toHaveLength(0);
    expect(plan.totalWidth).toBe(0);
    expect(plan.pinnedLeftWidth).toBe(0);
  });

  test("clamps overscan to array bounds", () => {
    const plan = planColumns({
      columns: columns.slice(0, 5),
      scrollLeft: 280,
      viewportWidth: 280,
      overscan: 10,
    });

    expect(plan.columns).toHaveLength(5);
  });
});
