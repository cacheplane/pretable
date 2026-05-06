import { describe, expect, test } from "vitest";

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
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(100);
    expect(grid.options.columns.find((col) => col.id === "c")?.pinned).toBeUndefined();
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
    expect(grid.options.columns.find((col) => col.id === "b")?.widthPx).toBe(250);
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
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(100);
  });
});
