import { describe, expect, test } from "vitest";

import {
  createGridCore,
  deriveSelectedRows,
  type PretableCellRange,
} from "../index";

interface DemoRow {
  id: string;
  name: string;
  status: string;
  message: string;
}

const columns = [
  { id: "name", header: "Name" },
  { id: "status", header: "Status" },
  { id: "message", header: "Message" },
] as const;

const rows: DemoRow[] = [
  { id: "a", name: "Apple", status: "open", message: "alpha" },
  { id: "b", name: "Bravo", status: "open", message: "beta" },
  { id: "c", name: "Cargo", status: "closed", message: "gamma" },
];

function makeGrid() {
  return createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
}

describe("selection state", () => {
  test("default state is empty ranges and null anchor", () => {
    const grid = makeGrid();
    const snapshot = grid.getSnapshot();

    expect(snapshot.selection.ranges).toEqual([]);
    expect(snapshot.selection.anchor).toBeNull();
  });

  test("setSelection replaces ranges and anchor", () => {
    const grid = makeGrid();
    const range: PretableCellRange = {
      startRowId: "a",
      endRowId: "b",
      startColumnId: "name",
      endColumnId: "status",
    };

    grid.setSelection({
      ranges: [range],
      anchor: { rowId: "a", columnId: "name" },
    });

    expect(grid.getSnapshot().selection.ranges).toEqual([range]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "a",
      columnId: "name",
    });
  });

  test("selectAll spans every row and every column", () => {
    const grid = makeGrid();

    grid.selectAll();

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);
    expect(anchor).toEqual({ rowId: "a", columnId: "name" });
  });

  test("clearSelection collapses to focused cell", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "b", columnId: "status" });
    grid.selectAll();

    grid.clearSelection();

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "status",
        endColumnId: "status",
      },
    ]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "b",
      columnId: "status",
    });
  });

  test("addRange appends and updates anchor to range start", () => {
    const grid = makeGrid();
    const r1: PretableCellRange = {
      startRowId: "a",
      endRowId: "a",
      startColumnId: "name",
      endColumnId: "name",
    };
    const r2: PretableCellRange = {
      startRowId: "c",
      endRowId: "c",
      startColumnId: "message",
      endColumnId: "message",
    };

    grid.addRange(r1);
    grid.addRange(r2);

    expect(grid.getSnapshot().selection.ranges).toEqual([r1, r2]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "c",
      columnId: "message",
    });
  });

  test("extendRangeFromAnchor replaces the active range", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "a",
          endRowId: "a",
          startColumnId: "name",
          endColumnId: "name",
        },
      ],
      anchor: { rowId: "a", columnId: "name" },
    });

    grid.extendRangeFromAnchor({ rowId: "c", columnId: "status" });

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "status",
      },
    ]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "a",
      columnId: "name",
    });
  });

  test("toggleRowSelection adds and removes a full-row range", () => {
    const grid = makeGrid();

    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);

    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.ranges).toEqual([]);
  });

  test("setSelectAllVisible(true) creates one full-row range per visible row", () => {
    const grid = makeGrid();
    grid.setFilter("status", "open");

    grid.setSelectAllVisible(true);

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "a",
        startColumnId: "name",
        endColumnId: "message",
      },
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);
  });

  test("ranges survive sort: stored IDs do not move", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "a",
          endRowId: "b",
          startColumnId: "name",
          endColumnId: "status",
        },
      ],
      anchor: { rowId: "a", columnId: "name" },
    });

    grid.setSort("name", "desc");

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "status",
      },
    ]);
  });

  test("filtered-out row in range stays in state but contributes no derived selection", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "c",
          endRowId: "c",
          startColumnId: "name",
          endColumnId: "message",
        },
      ],
      anchor: { rowId: "c", columnId: "name" },
    });

    grid.setFilter("status", "open");

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "c",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.size).toBe(0);
  });

  test("derived rows: full-row range yields 'selected'", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.get("b")).toBe("selected");
    expect(derived.size).toBe(1);
  });

  test("derived rows: partial-row range yields 'indeterminate'", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "b",
          endRowId: "b",
          startColumnId: "name",
          endColumnId: "status",
        },
      ],
      anchor: { rowId: "b", columnId: "name" },
    });

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.get("b")).toBe("indeterminate");
  });
});
