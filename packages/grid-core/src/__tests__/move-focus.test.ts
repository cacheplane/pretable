import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

const columns = [
  { id: "c1", header: "C1" },
  { id: "c2", header: "C2" },
  { id: "c3", header: "C3" },
] as const;

const rows = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }];

function makeGrid() {
  return createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
}

describe("moveFocus", () => {
  test("from null focus, 'down' lands on first row (no step applied)", () => {
    const grid = makeGrid();

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c1" });
  });

  test("from null focus, 'up' lands on last row (no step applied)", () => {
    const grid = makeGrid();

    grid.moveFocus("up");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r4", columnId: "c1" });
  });

  test("from null focus, 'right' lands on first column", () => {
    const grid = makeGrid();

    grid.moveFocus("right");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c1" });
  });

  test("from null focus, 'left' lands on last column", () => {
    const grid = makeGrid();

    grid.moveFocus("left");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c3" });
  });

  test("'right' moves focus one column right", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("right");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c2" });
  });

  test("'left' at first column does not move", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r2", columnId: "c1" });

    grid.moveFocus("left");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r2", columnId: "c1" });
  });

  test("'down' at last row does not move", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r4", columnId: "c2" });

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r4", columnId: "c2" });
  });

  test("jumpToEdge 'down' goes to last row", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c2" });

    grid.moveFocus("down", { jumpToEdge: true });

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r4", columnId: "c2" });
  });

  test("jumpToEdge 'right' goes to last column", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("right", { jumpToEdge: true });

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c3" });
  });

  test("extend collapses to focus when no anchor exists", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("down", { extend: true });

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "r2",
        endRowId: "r2",
        startColumnId: "c1",
        endColumnId: "c1",
      },
    ]);
    expect(anchor).toEqual({ rowId: "r2", columnId: "c1" });
  });

  test("extend with existing anchor extends active range", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "r1",
          endRowId: "r1",
          startColumnId: "c1",
          endColumnId: "c1",
        },
      ],
      anchor: { rowId: "r1", columnId: "c1" },
    });
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("down", { extend: true });
    grid.moveFocus("right", { extend: true });

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "r1",
        endRowId: "r2",
        startColumnId: "c1",
        endColumnId: "c2",
      },
    ]);
    expect(anchor).toEqual({ rowId: "r1", columnId: "c1" });
  });

  test("non-extend movement collapses ranges to single focused cell", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });
    grid.selectAll();

    grid.moveFocus("right");

    const { ranges } = grid.getSnapshot().selection;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      startRowId: "r1",
      endRowId: "r1",
      startColumnId: "c2",
      endColumnId: "c2",
    });
  });
});

describe("moveFocus over grouped rows", () => {
  type Row = { id: string; sector: string; qty: number };
  const make = () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "sector", header: "Sector" },
        { id: "qty", header: "Qty" },
      ],
      rows: [
        { id: "r1", sector: "Tech", qty: 1 },
        { id: "r2", sector: "Tech", qty: 2 },
        { id: "r3", sector: "Energy", qty: 3 },
      ],
      getRowId: (row) => row.id,
    });
    grid.setRowGroups(["sector"]);
    return grid;
  };

  const isGroup = (id: string | null) =>
    id !== null && id.startsWith("__group__:");

  test("down from the first data row lands ON the next group row", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    // [group Energy, r3, group Tech, r1, r2] — order is sector-ascending.
    const firstData = visible.find((r) => r.kind === "data")!;
    grid.setFocus({ rowId: firstData.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(isGroup(grid.getSnapshot().focus.rowId)).toBe(true);
  });

  test("vertical movement preserves the focused column", () => {
    const grid = make();
    const firstData = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "data")!;
    grid.setFocus({ rowId: firstData.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(grid.getSnapshot().focus.columnId).toBe("qty");
  });

  test("down from the last row is a no-op, not a wrap", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    const last = visible[visible.length - 1]!;
    grid.setFocus({ rowId: last.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(grid.getSnapshot().focus.rowId).toBe(last.id);
  });

  test("focus can reach every visible row, group rows included", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    grid.setFocus({ rowId: visible[0]!.id, columnId: "qty" });

    const seen = [grid.getSnapshot().focus.rowId];
    for (let i = 1; i < visible.length; i += 1) {
      grid.moveFocus("down");
      seen.push(grid.getSnapshot().focus.rowId);
    }
    expect(seen).toEqual(visible.map((r) => r.id));
  });

  test("collapsing the group holding focus moves focus to that group row", () => {
    const grid = make();
    const dataRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "data")!;
    const groupRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "group")!;
    grid.setFocus({ rowId: dataRow.id, columnId: "qty" });

    grid.setGroupExpanded(groupRow.id, false);

    // The focused row no longer exists in the flat list; focus must not dangle.
    const ids = grid.getSnapshot().visibleRows.map((r) => r.id);
    expect(ids).toContain(grid.getSnapshot().focus.rowId);
    expect(grid.getSnapshot().focus.rowId).toBe(groupRow.id);
    // Column stability holds through a collapse too.
    expect(grid.getSnapshot().focus.columnId).toBe("qty");
  });

  test("collapseAll re-anchors focus onto the surviving ancestor group row", () => {
    const grid = make();
    const dataRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "data")!;
    const groupRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "group")!;
    grid.setFocus({ rowId: dataRow.id, columnId: "qty" });

    grid.collapseAll();

    expect(grid.getSnapshot().focus.rowId).toBe(groupRow.id);
  });

  test("a collapse that hides nothing leaves focus alone", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    const energy = visible.find((r) => r.kind === "group")!;
    const tech = visible.filter((r) => r.kind === "group")[1]!;
    // Focus sits under Energy; collapsing Tech cannot disturb it.
    const energyChild = visible[visible.indexOf(energy) + 1]!;
    grid.setFocus({ rowId: energyChild.id, columnId: "qty" });

    grid.setGroupExpanded(tech.id, false);

    expect(grid.getSnapshot().focus.rowId).toBe(energyChild.id);
  });
});
