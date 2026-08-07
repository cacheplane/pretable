import { describe, expect, test, vi } from "vitest";

import { createGridCore } from "../index";

interface Row {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

const baseColumns = [
  { id: "a", header: "A", widthPx: 100 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
] as const;

const baseRows: Row[] = [
  { id: "r1", a: "a1", b: "b1", c: "c1", d: "d1" },
  { id: "r2", a: "a2", b: "b2", c: "c2", d: "d2" },
];

function makeGrid(columnsOverride?: typeof baseColumns) {
  return createGridCore<Row>({
    columns: [...(columnsOverride ?? baseColumns)],
    rows: baseRows,
    getRowId: (row) => row.id,
  });
}

/**
 * The engine invariant: array order is visual order. Every `pinned: "left"`
 * column comes first, then every unpinned column, then every `pinned: "right"`
 * column — the exact order `planColumns` renders the three regions in.
 *
 * The synthetic row-select column leads its own region, not the whole array:
 * it is pinned left by default, but `rowSelectionColumn.pinned: false` makes it
 * scrollable, and it must not then jump ahead of the left-pinned run.
 */
function expectGrouped(
  columns: readonly { id: string; pinned?: "left" | "right" }[],
): void {
  const rank = (pinned?: "left" | "right"): number =>
    pinned === "left" ? 0 : pinned === "right" ? 2 : 1;
  const ranks = columns.map((c) => rank(c.pinned));

  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

  const synthIdx = columns.findIndex((c) => c.id === "__pretable_row_select__");
  if (synthIdx !== -1) {
    const synthRank = ranks[synthIdx]!;
    expect(ranks.indexOf(synthRank)).toBe(synthIdx);
  }
}

describe("setColumnWidth", () => {
  test("updates the column width", () => {
    const grid = makeGrid();
    grid.setColumnWidth("b", 250);
    expect(grid.options.columns.find((c) => c.id === "b")?.widthPx).toBe(250);
  });

  test("clamps to default min (40)", () => {
    const grid = makeGrid();
    grid.setColumnWidth("a", 10);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(40);
  });

  test("clamps to per-column min", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, minWidthPx: 80 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 10);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(80);
  });

  test("clamps to per-column max", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, maxWidthPx: 200 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 999);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(200);
  });

  test("no-ops when width is unchanged", () => {
    const grid = makeGrid();
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setColumnWidth("a", 100); // already 100
    expect(emits).toBe(0);
  });

  test("no-ops for unknown column id", () => {
    const grid = makeGrid();
    grid.setColumnWidth("nonexistent", 200);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(100);
  });
});

describe("moveColumn", () => {
  test("moves column to a new index", () => {
    const grid = makeGrid();
    grid.moveColumn("a", 2);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["b", "c", "a", "d"]);
  });

  test("clamps toIndex to valid bounds", () => {
    const grid = makeGrid();
    grid.moveColumn("a", -1);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    grid.moveColumn("a", 99);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["b", "c", "d", "a"]);
  });

  test("auto-pins when column lands in pinned region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 1);
    const cAfter = grid.options.columns.find((col) => col.id === "c");
    expect(cAfter?.pinned).toBe("left");
  });

  test("auto-unpins when column leaves pinned region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("a", 2);
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.pinned).toBeUndefined();
  });

  test("synthetic row-select column id is silently no-op'd", () => {
    const grid = makeGrid();
    grid.moveColumn("__pretable_row_select__", 2);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("clamps toIndex >= 1 when synthetic column at index 0", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "__pretable_row_select__", header: "" },
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 0);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "__pretable_row_select__",
      "c",
      "a",
      "b",
    ]);
  });

  test("right-pinned column dragged to index 0 unpins and lands there", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 0);
    expect(grid.options.columns.map((col) => col.id)).toEqual(["c", "a", "b"]);
    expect(
      grid.options.columns.find((col) => col.id === "c")?.pinned,
    ).toBeUndefined();
    expectGrouped(grid.options.columns);
  });

  test("right-pinned column dragged into the leading pinned run left-pins", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("d", 1);
    expect(grid.options.columns.find((col) => col.id === "d")?.pinned).toBe(
      "left",
    );
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("unpinned column dropped at the first right-pinned slot right-pins", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("a", 2);
    expect(grid.options.columns.find((col) => col.id === "a")?.pinned).toBe(
      "right",
    );
    // It joins the trailing group, so it is array-trailing.
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "c", "a"]);
    expectGrouped(grid.options.columns);
  });

  test("the same column dropped one slot earlier stays unpinned", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("a", 1);
    expect(
      grid.options.columns.find((col) => col.id === "a")?.pinned,
    ).toBeUndefined();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "a", "c"]);
    expectGrouped(grid.options.columns);
  });
});

describe("setColumnOrder", () => {
  test("reorders the columns", () => {
    const grid = makeGrid();
    grid.setColumnOrder(["d", "c", "b", "a"]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("preserves pin state and regroups by it", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnOrder(["d", "c", "b", "a"]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(grid.options.columns.find((col) => col.id === "a")?.pinned).toBe(
      "left",
    );
    expect(grid.options.columns.find((col) => col.id === "d")?.pinned).toBe(
      "right",
    );
    expect(
      grid.options.columns.find((col) => col.id === "b")?.pinned,
    ).toBeUndefined();
    expectGrouped(grid.options.columns);
  });

  test("normalises an interleaved request into the invariant", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnOrder(["b", "d", "a", "c"]);
    // Relative order within each region is honoured; the regions are not.
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("ignores unknown ids", () => {
    const grid = makeGrid();
    grid.setColumnOrder(["nope", "d", "also-nope", "a"]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("appends omitted ids in their current relative order", () => {
    const grid = makeGrid();
    grid.setColumnOrder(["c"]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("keeps the synthetic column at index 0 even when listed elsewhere", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "__pretable_row_select__", header: "" },
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnOrder(["b", "__pretable_row_select__", "a"]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "__pretable_row_select__",
      "b",
      "a",
      "c",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("does not emit when the resulting order is unchanged", () => {
    const grid = makeGrid();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnOrder(["a", "b", "c", "d"]);
    expect(listener).not.toHaveBeenCalled();

    grid.setColumnOrder(["nope"]);
    expect(listener).not.toHaveBeenCalled();

    grid.setColumnOrder(["b"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
});

describe("setColumnPinned", () => {
  test("pins an unpinned column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("c", "left");
    const cAfter = grid.options.columns.find((col) => col.id === "c");
    expect(cAfter?.pinned).toBe("left");
    // Pinning moves it to the start (or end of pinned region).
    expect(grid.options.columns[0]?.id).toBe("c");
  });

  test("unpins a pinned column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("a", null);
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.pinned).toBeUndefined();
    // a should now be at the start of the unpinned region (index 1, after b).
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "a", "c"]);
  });

  test("pins a column to the right", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("a", "right");
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.pinned).toBe("right");
    // Pinning right moves it to the start of the right-pinned region (the end).
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "c", "a"]);
  });

  test("stacks right-pinned columns in pin order at the end", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("a", "right");
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "a", "c"]);
    expect(
      grid.options.columns.filter((col) => col.pinned === "right").length,
    ).toBe(2);
  });

  test("re-pins a left-pinned column to the right", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("a", "right");
    expect(grid.options.columns.find((col) => col.id === "a")?.pinned).toBe(
      "right",
    );
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "c", "a"]);
  });

  test("unpins a right-pinned column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("b", null);
    expect(
      grid.options.columns.find((col) => col.id === "b")?.pinned,
    ).toBeUndefined();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "b"]);
  });

  test("unpinning a right-pinned column leaves it at the boundary, not the front", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", pinned: "right", widthPx: 100 },
        { id: "e", header: "E", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("d", null);
    expect(
      grid.options.columns.find((col) => col.id === "d")?.pinned,
    ).toBeUndefined();
    // d stays at the trailing end of the scrollable run (just before the
    // remaining right-pinned group) rather than jumping to its front.
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  test("re-pins a right-pinned column to the left", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", pinned: "right", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("c", "left");
    expect(grid.options.columns.find((col) => col.id === "c")?.pinned).toBe(
      "left",
    );
    // Joining the left region puts it at that region's trailing edge — it must
    // not be left stranded at the right boundary.
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "c", "b"]);
  });

  test("does not emit when the pin state is unchanged", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "right", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnPinned("a", "right");
    expect(listener).not.toHaveBeenCalled();

    grid.setColumnPinned("b", null);
    expect(listener).not.toHaveBeenCalled();

    grid.setColumnPinned("b", "right");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("autosizeColumn", () => {
  test("computes a width for the target column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A long header text", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
      autosize: false,
    });
    grid.autosizeColumn("a");
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.widthPx).toBeDefined();
    expect(aAfter?.widthPx).not.toBe(100);
  });

  test("synthetic column id is silently no-op'd", () => {
    const grid = makeGrid();
    grid.autosizeColumn("__pretable_row_select__");
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resetColumnLayout", () => {
  test("restores widths and pinned state to the original input", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 250);
    grid.setColumnPinned("c", "left");
    grid.resetColumnLayout();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "b", "c"]);
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(
      100,
    );
    expect(
      grid.options.columns.find((col) => col.id === "c")?.pinned,
    ).toBeUndefined();
  });
});

describe("mergeColumnsFromProps", () => {
  test("preserves engine-state widths for surviving columns", () => {
    const grid = makeGrid();
    grid.setColumnWidth("b", 250);
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
      { id: "d", header: "D", widthPx: 100 },
    ]);
    expect(grid.options.columns.find((col) => col.id === "b")?.widthPx).toBe(
      250,
    );
  });

  test("adds new columns at their prop position with prop widthPx", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "new", header: "New", widthPx: 150 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
      { id: "d", header: "D", widthPx: 100 },
    ]);
    const newCol = grid.options.columns.find((col) => col.id === "new");
    expect(newCol?.widthPx).toBe(150);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "new",
      "b",
      "c",
      "d",
    ]);
  });

  test("drops removed columns", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ]);
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "c"]);
  });

  test("subsequent resetColumnLayout resets to the new prop shape", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "x", header: "X", widthPx: 100 },
    ]);
    grid.setColumnWidth("a", 250);
    grid.resetColumnLayout();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "x"]);
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(
      100,
    );
  });
});

describe("array-order-is-visual-order invariant on input", () => {
  test("interleaved declared columns are regrouped at construction", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100, pinned: "right" },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", widthPx: 100, pinned: "left" },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "d",
      "a",
      "c",
      "b",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("grouping at construction is stable within each region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, pinned: "left" },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100, pinned: "left" },
        { id: "d", header: "D", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
  });

  test("mergeColumnsFromProps regroups prop order around runtime pins", () => {
    const grid = makeGrid();
    grid.setColumnPinned("c", "right");
    // Props arrive in declared order (a, b, c, d) but `c` is pinned right at
    // runtime — prop order alone would put it back in the middle.
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
      { id: "d", header: "D", widthPx: 100 },
    ]);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("resetColumnLayout restores a grouped array from interleaved config", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100, pinned: "right" },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 0);
    grid.setColumnPinned("a", "left");
    grid.resetColumnLayout();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "c", "b"]);
    expectGrouped(grid.options.columns);
  });
});

describe("synthetic row-select column placement", () => {
  test("a left-pinned synthetic column leads the whole array", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, pinned: "left" },
        { id: "__pretable_row_select__", header: "", pinned: "left" },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "__pretable_row_select__",
      "a",
      "b",
    ]);
    expectGrouped(grid.options.columns);
  });

  test("an unpinned synthetic column leads the scrollable region, not the array", () => {
    // `rowSelectionColumn.pinned: false` makes the synthetic column scrollable.
    // planColumns renders left-pinned columns first, so seating it at index 0
    // ahead of them would put array order out of step with visual order.
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "__pretable_row_select__", header: "" },
        { id: "b", header: "B", widthPx: 100, pinned: "left" },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "b",
      "__pretable_row_select__",
      "a",
    ]);
    expectGrouped(grid.options.columns);
  });
});
