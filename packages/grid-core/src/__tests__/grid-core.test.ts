import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface DemoRow {
  id: string;
  name: string;
  status: string;
  message: string;
}

const columns = [
  { id: "name", header: "Name" },
  { id: "status", header: "Status" },
  { id: "message", header: "Message", wrap: true },
] as const;

const rows: DemoRow[] = [
  { id: "a", name: "Zulu", status: "open", message: "alpha ready" },
  { id: "b", name: "Alpha", status: "open", message: "beta error" },
  { id: "c", name: "Bravo", status: "closed", message: "gamma archived" },
];

describe("grid-core", () => {
  test("stable row identity survives sorting and filtering", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.selectRow("b");
    grid.setSort("name", "asc");
    grid.setFilter("status", "open");

    const snapshot = grid.getSnapshot();

    expect(snapshot.visibleRows.map((row) => row.id)).toEqual(["b", "a"]);
    expect(snapshot.selection.rowIds).toEqual(["b"]);
  });

  test("limited filter state narrows rows without losing selection ids", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.selectRow("c");
    grid.setFilter("message", "error");

    const snapshot = grid.getSnapshot();

    expect(snapshot.visibleRows.map((row) => row.id)).toEqual(["b"]);
    expect(snapshot.selection.rowIds).toEqual(["c"]);
  });

  test("keyboard focus moves by row id and visible order, not React-local indexes", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.setSort("name", "asc");
    grid.setFocus("b", "name");
    grid.moveFocus(1);

    expect(grid.getSnapshot().focus).toEqual({
      rowId: "c",
      columnId: "name",
    });

    grid.moveFocus(1);

    expect(grid.getSnapshot().focus).toEqual({
      rowId: "a",
      columnId: "name",
    });
  });

  test("the external store can return a snapshot and emit change notifications", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });
    let notifications = 0;

    const unsubscribe = grid.subscribe(() => {
      notifications += 1;
    });

    grid.setViewport({ scrollTop: 240, height: 320 });
    unsubscribe();
    grid.setViewport({ scrollTop: 480, height: 320 });

    expect(notifications).toBe(1);
    expect(grid.getSnapshot().viewport).toEqual({
      scrollTop: 480,
      height: 320,
    });
  });

  test("getSnapshot returns a stable reference until state changes", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    const first = grid.getSnapshot();
    const second = grid.getSnapshot();

    expect(second).toBe(first);

    grid.setViewport({ scrollTop: 44, height: 320 });

    const third = grid.getSnapshot();

    expect(third).not.toBe(first);
    expect(grid.getSnapshot()).toBe(third);
  });
});
