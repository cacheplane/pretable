import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface DemoRow {
  id: string;
  group: string;
  score: number;
  name: string;
  notes: string;
}

const columns = [
  { id: "group", header: "Group" },
  { id: "score", header: "Score" },
  { id: "name", header: "Name" },
  { id: "notes", header: "Notes", sortable: false },
] as const;

const rows: DemoRow[] = [
  { id: "1", group: "b", score: 10, name: "delta", notes: "n1" },
  { id: "2", group: "a", score: 20, name: "alpha", notes: "n2" },
  { id: "3", group: "a", score: 10, name: "carol", notes: "n3" },
  { id: "4", group: "b", score: 20, name: "bravo", notes: "n4" },
  { id: "5", group: "a", score: 20, name: "erin", notes: "n5" },
];

function makeGrid() {
  return createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
}

function ids(grid: ReturnType<typeof makeGrid>): string[] {
  return grid.getSnapshot().visibleRows.map((row) => row.id);
}

describe("multi-column sort", () => {
  test("replaceSort cascades: ties on the first key fall to the second", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);

    // group a: 2 (20), 5 (20), 3 (10) — then group b: 4 (20), 1 (10)
    expect(ids(grid)).toEqual(["2", "5", "3", "4", "1"]);
  });

  test("stability: rows equal on every sort key keep source order", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);

    const order = ids(grid);
    // rows 2 and 5 tie on (group, score); source order has 2 before 5
    expect(order.indexOf("2")).toBeLessThan(order.indexOf("5"));
  });

  test("snapshot.sort reflects the ordered entry list", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);

    expect(grid.getSnapshot().sort).toEqual([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);
  });

  test("setSort replaces the whole list with a single entry", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);
    grid.setSort("name", "asc");

    expect(grid.getSnapshot().sort).toEqual([
      { columnId: "name", direction: "asc" },
    ]);
    expect(ids(grid)).toEqual(["2", "4", "3", "1", "5"]);
  });

  test("setSort(null, null) clears to []", () => {
    const grid = makeGrid();

    grid.setSort("name", "asc");
    grid.setSort(null, null);

    expect(grid.getSnapshot().sort).toEqual([]);
    expect(ids(grid)).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("setSort with a null direction clears to []", () => {
    const grid = makeGrid();

    grid.setSort("name", "asc");
    grid.setSort("name", null);

    expect(grid.getSnapshot().sort).toEqual([]);
  });

  test("replaceSort drops unknown columnIds", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "does-not-exist", direction: "asc" },
      { columnId: "score", direction: "asc" },
    ]);

    expect(grid.getSnapshot().sort).toEqual([
      { columnId: "score", direction: "asc" },
    ]);
  });

  test("replaceSort drops sortable:false columns", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "notes", direction: "asc" },
      { columnId: "score", direction: "asc" },
    ]);

    expect(grid.getSnapshot().sort).toEqual([
      { columnId: "score", direction: "asc" },
    ]);
  });

  test("replaceSort change-guard: an equal list keeps the same snapshot reference", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);
    const before = grid.getSnapshot();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);

    expect(grid.getSnapshot()).toBe(before);
  });

  test("replaceSort([]) restores source order", () => {
    const grid = makeGrid();

    grid.replaceSort([
      { columnId: "group", direction: "asc" },
      { columnId: "score", direction: "desc" },
    ]);
    grid.replaceSort([]);

    expect(grid.getSnapshot().sort).toEqual([]);
    expect(ids(grid)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
