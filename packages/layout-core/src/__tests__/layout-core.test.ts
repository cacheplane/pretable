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

  test("reports pinnedRightWidth of 0 when nothing is pinned right", () => {
    const plan = planColumns({
      columns,
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 1,
    });

    expect(plan.pinnedRightWidth).toBe(0);
    expect(plan.columns.every((c) => c.right === undefined)).toBe(true);
  });
});

describe("planColumns — right-pinned columns", () => {
  // 6 columns x 100px: c0 pinned left, c4 + c5 pinned right.
  const mixedColumns = [
    { id: "c0", width: 100, pinned: "left" as const },
    { id: "c1", width: 100 },
    { id: "c2", width: 100 },
    { id: "c3", width: 100 },
    { id: "c4", width: 100, pinned: "right" as const },
    { id: "c5", width: 100, pinned: "right" as const },
  ];

  test("orders columns as [pinnedLeft, visibleScrollable, pinnedRight]", () => {
    const plan = planColumns({
      columns: mixedColumns,
      scrollLeft: 0,
      viewportWidth: 600,
      overscan: 0,
    });

    expect(plan.columns.map((c) => c.id)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
    expect(plan.totalWidth).toBe(600);
    expect(plan.pinnedLeftWidth).toBe(100);
    expect(plan.pinnedRightWidth).toBe(200);
  });

  test("measures right offsets from the viewport's right edge", () => {
    const plan = planColumns({
      columns: mixedColumns,
      scrollLeft: 0,
      viewportWidth: 600,
      overscan: 0,
    });

    const byId = new Map(plan.columns.map((c) => [c.id, c]));

    // The last right-pinned column sits flush against the right edge; each
    // earlier one is offset by the total width of the ones after it.
    expect(byId.get("c5")).toMatchObject({ pinned: "right", right: 0 });
    expect(byId.get("c4")).toMatchObject({ pinned: "right", right: 100 });

    // Left-pinned and scrollable columns keep using `left` only.
    expect(byId.get("c0")).toMatchObject({ pinned: "left", left: 0 });
    expect(byId.get("c0")?.right).toBeUndefined();
    expect(byId.get("c1")?.right).toBeUndefined();
  });

  test("keeps right-pinned columns at every scroll position", () => {
    for (const scrollLeft of [0, 150, 600 - 300]) {
      const plan = planColumns({
        columns: mixedColumns,
        scrollLeft,
        viewportWidth: 300,
        overscan: 0,
      });

      const rightIds = plan.columns
        .filter((c) => c.pinned === "right")
        .map((c) => c.id);

      expect(rightIds).toEqual(["c4", "c5"]);
      expect(plan.pinnedRightWidth).toBe(200);
    }
  });

  test("clamps the scrollable window to zero when pinned widths fill the viewport", () => {
    // 100 (left) + 200 (right) pinned out of a 300px viewport leaves no room.
    const plan = planColumns({
      columns: mixedColumns,
      scrollLeft: 0,
      viewportWidth: 300,
      overscan: 0,
    });

    expect(plan.columns.map((c) => c.id)).toEqual(["c0", "c4", "c5"]);
    expect(plan.columns.every((c) => c.pinned !== undefined)).toBe(true);
    expect(plan.columns.every((c) => c.width > 0)).toBe(true);
    expect(plan.columns.every((c) => c.left >= 0)).toBe(true);
    expect(plan.columns.every((c) => (c.right ?? 0) >= 0)).toBe(true);
  });

  test("shrinks the scrollable window by the right-pinned width", () => {
    // 8 columns x 100px: c0 pinned left, c7 pinned right, viewport 500.
    // Scrollable c1..c6 sit at content offsets 100..600. The right-pinned
    // group covers content [400, 500), so c4 (at 400) is hidden behind it —
    // it *would* be visible if the right-pinned width weren't subtracted.
    const wideColumns = [
      { id: "c0", width: 100, pinned: "left" as const },
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `c${i + 1}`,
        width: 100,
      })),
      { id: "c7", width: 100, pinned: "right" as const },
    ];

    const withRightPin = planColumns({
      columns: wideColumns,
      scrollLeft: 0,
      viewportWidth: 500,
      overscan: 0,
    });

    expect(withRightPin.columns.map((c) => c.id)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c7",
    ]);

    const withoutRightPin = planColumns({
      columns: wideColumns.map((col) =>
        col.pinned === "right" ? { id: col.id, width: col.width } : col,
      ),
      scrollLeft: 0,
      viewportWidth: 500,
      overscan: 0,
    });

    // Same fixture, no right pin: c4 is visible.
    expect(withoutRightPin.columns.map((c) => c.id)).toContain("c4");
  });

  test("returns both pinned groups when every column is pinned", () => {
    const plan = planColumns({
      columns: [
        { id: "a", width: 100, pinned: "left" as const },
        { id: "b", width: 150, pinned: "right" as const },
        { id: "c", width: 50, pinned: "right" as const },
      ],
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 2,
    });

    expect(plan.columns.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(plan.totalWidth).toBe(300);
    expect(plan.pinnedLeftWidth).toBe(100);
    expect(plan.pinnedRightWidth).toBe(200);
    expect(plan.columns.find((c) => c.id === "b")?.right).toBe(50);
    expect(plan.columns.find((c) => c.id === "c")?.right).toBe(0);
  });

  test("keeps scrollable left offsets free of the right-pinned widths", () => {
    const plan = planColumns({
      columns: mixedColumns,
      scrollLeft: 0,
      viewportWidth: 600,
      overscan: 0,
    });

    expect(plan.columns.find((c) => c.id === "c1")?.left).toBe(100);
    expect(plan.columns.find((c) => c.id === "c2")?.left).toBe(200);
    expect(plan.columns.find((c) => c.id === "c3")?.left).toBe(300);
  });

  test("gives right-pinned columns their true content offset as `left`", () => {
    // c0 (left, 100) | c1..c3 (scrollable, 100 each) | c4, c5 (right, 100
    // each). Laid out end to end the content offsets are 0, 100, 200, 300,
    // 400, 500 — the right-pinned pair belongs at 400 and 500, not at 0.
    // Consumers map plan entries onto content coordinates (the reorder drop
    // indicator reads `columnLefts[dropIndex]`), so a placeholder would put
    // the indicator at content x=0.
    const plan = planColumns({
      columns: mixedColumns,
      scrollLeft: 0,
      viewportWidth: 600,
      overscan: 0,
    });
    const byId = new Map(plan.columns.map((c) => [c.id, c]));

    expect(byId.get("c4")?.left).toBe(400);
    expect(byId.get("c5")?.left).toBe(500);
    // The last right-pinned column ends exactly at the total content width.
    expect((byId.get("c5")?.left ?? 0) + (byId.get("c5")?.width ?? 0)).toBe(
      plan.totalWidth,
    );
  });

  test("keeps right-pinned `left` stable across scroll positions and viewports", () => {
    // `left` is a content coordinate, so unlike `right` it must not move with
    // the scrollport.
    for (const [scrollLeft, viewportWidth] of [
      [0, 600],
      [150, 400],
      [300, 300],
    ]) {
      const plan = planColumns({
        columns: mixedColumns,
        scrollLeft,
        viewportWidth,
        overscan: 0,
      });
      const byId = new Map(plan.columns.map((c) => [c.id, c]));

      expect(byId.get("c4")?.left).toBe(400);
      expect(byId.get("c5")?.left).toBe(500);
    }
  });

  test("gives right-pinned columns a true content offset when everything is pinned", () => {
    // a (left, 100) | b (right, 150) | c (right, 50) — no scrollable run at
    // all, so the right group starts right after the left group.
    const plan = planColumns({
      columns: [
        { id: "a", width: 100, pinned: "left" as const },
        { id: "b", width: 150, pinned: "right" as const },
        { id: "c", width: 50, pinned: "right" as const },
      ],
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 2,
    });
    const byId = new Map(plan.columns.map((c) => [c.id, c]));

    expect(byId.get("a")?.left).toBe(0);
    expect(byId.get("b")?.left).toBe(100);
    expect(byId.get("c")?.left).toBe(250);
  });
});
