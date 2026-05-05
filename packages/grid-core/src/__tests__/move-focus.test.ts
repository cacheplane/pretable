import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

const columns = [
  { id: "c1", header: "C1" },
  { id: "c2", header: "C2" },
  { id: "c3", header: "C3" },
] as const;

const rows = [
  { id: "r1" },
  { id: "r2" },
  { id: "r3" },
  { id: "r4" },
];

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
