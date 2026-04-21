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

    grid.setViewport({
      scrollTop: 240,
      scrollLeft: 0,
      height: 320,
      width: 1440,
    });
    unsubscribe();
    grid.setViewport({
      scrollTop: 480,
      scrollLeft: 100,
      height: 320,
      width: 1440,
    });

    expect(notifications).toBe(1);
    expect(grid.getSnapshot().viewport).toEqual({
      scrollTop: 480,
      scrollLeft: 100,
      height: 320,
      width: 1440,
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

    grid.setViewport({
      scrollTop: 44,
      scrollLeft: 0,
      height: 320,
      width: 1440,
    });

    const third = grid.getSnapshot();

    expect(third).not.toBe(first);
    expect(grid.getSnapshot()).toBe(third);
  });

  test("declarative autosize computes widthPx for columns without explicit widths", () => {
    const grid = createGridCore({
      columns: [
        { id: "short", header: "ID" },
        { id: "long", header: "Description" },
        { id: "fixed", header: "Fixed", widthPx: 200 },
      ],
      rows: [
        {
          id: "1",
          short: "A",
          long: "A much longer text value that should produce a wider column",
          fixed: "x",
        },
        { id: "2", short: "B", long: "Short", fixed: "y" },
      ],
      getRowId: (row) => String(row.id),
      autosize: true,
    });

    const shortCol = grid.options.columns.find((c) => c.id === "short")!;
    const longCol = grid.options.columns.find((c) => c.id === "long")!;
    const fixedCol = grid.options.columns.find((c) => c.id === "fixed")!;

    expect(shortCol.widthPx).toBeDefined();
    expect(shortCol.widthPx).toBeGreaterThanOrEqual(60);
    expect(shortCol.widthPx).toBeLessThanOrEqual(400);
    expect(longCol.widthPx).toBeDefined();
    expect(longCol.widthPx!).toBeGreaterThan(shortCol.widthPx!);
    expect(fixedCol.widthPx).toBe(200);
    expect(grid.getSnapshot().totalRowCount).toBe(2);
  });

  test("declarative autosize accepts custom options", () => {
    const grid = createGridCore({
      columns: [{ id: "name", header: "Name" }],
      rows: [
        { id: "1", name: "A very long name that would exceed a low max width" },
      ],
      getRowId: (row) => String(row.id),
      autosize: { maxWidthPx: 100 },
    });

    const nameCol = grid.options.columns.find((c) => c.id === "name")!;

    expect(nameCol.widthPx).toBeDefined();
    expect(nameCol.widthPx!).toBeLessThanOrEqual(100);
  });

  test("imperative autosizeColumns recomputes widths and notifies subscribers", () => {
    const grid = createGridCore({
      columns: [{ id: "name", header: "Name" }],
      rows: [{ id: "1", name: "Short" }],
      getRowId: (row) => String(row.id),
    });

    let notifications = 0;
    grid.subscribe(() => {
      notifications += 1;
    });

    grid.autosizeColumns();

    expect(notifications).toBe(1);

    const nameCol = grid.options.columns.find((c) => c.id === "name")!;

    expect(nameCol.widthPx).toBeDefined();
    expect(nameCol.widthPx).toBeGreaterThanOrEqual(60);
  });

  test("setViewport emits when scrollLeft changes and suppresses when unchanged", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });
    let notifications = 0;

    grid.subscribe(() => {
      notifications += 1;
    });

    grid.setViewport({ scrollTop: 0, scrollLeft: 0, height: 320, width: 1440 });

    expect(notifications).toBe(1);

    // Same state — should not emit
    grid.setViewport({ scrollTop: 0, scrollLeft: 0, height: 320, width: 1440 });

    expect(notifications).toBe(1);

    // scrollLeft changed — should emit
    grid.setViewport({
      scrollTop: 0,
      scrollLeft: 200,
      height: 320,
      width: 1440,
    });

    expect(notifications).toBe(2);
  });

  test("applyTransaction adds rows and they appear in the snapshot", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({
      add: [{ id: "d", name: "Delta", status: "open", message: "new row" }],
    });

    const snapshot = grid.getSnapshot();

    expect(snapshot.totalRowCount).toBe(4);
    expect(snapshot.visibleRows.map((r) => r.id)).toContain("d");
  });

  test("applyTransaction updates existing rows via partial merge", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({
      update: [{ id: "a", name: "Updated Zulu" }],
    });

    const snapshot = grid.getSnapshot();
    const updatedRow = snapshot.visibleRows.find((r) => r.id === "a");

    expect(updatedRow?.row).toMatchObject({
      id: "a",
      name: "Updated Zulu",
      status: "open",
      message: "alpha ready",
    });
  });

  test("applyTransaction removes rows by id", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({ remove: ["b"] });

    const snapshot = grid.getSnapshot();

    expect(snapshot.totalRowCount).toBe(2);
    expect(snapshot.visibleRows.map((r) => r.id)).not.toContain("b");
  });

  test("applyTransaction handles add, update, and remove in a single call", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({
      add: [{ id: "d", name: "Delta", status: "open", message: "added" }],
      update: [{ id: "a", name: "Updated" }],
      remove: ["c"],
    });

    const snapshot = grid.getSnapshot();

    expect(snapshot.totalRowCount).toBe(3);
    expect(snapshot.visibleRows.map((r) => r.id)).toEqual(
      expect.arrayContaining(["a", "b", "d"]),
    );
    expect(snapshot.visibleRows.map((r) => r.id)).not.toContain("c");
    expect(snapshot.visibleRows.find((r) => r.id === "a")?.row).toMatchObject({
      name: "Updated",
    });
  });

  test("applyTransaction emits exactly one notification", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });
    let notifications = 0;

    grid.subscribe(() => {
      notifications += 1;
    });

    grid.applyTransaction({
      add: [{ id: "d", name: "Delta", status: "open", message: "new" }],
      update: [{ id: "a", name: "Updated" }],
      remove: ["c"],
    });

    expect(notifications).toBe(1);
  });

  test("applyTransaction silently skips update for nonexistent row", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({
      update: [{ id: "nonexistent", name: "Ghost" }],
    });

    const snapshot = grid.getSnapshot();

    expect(snapshot.totalRowCount).toBe(3);
  });

  test("applyTransaction silently skips remove for nonexistent row", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({ remove: ["nonexistent"] });

    const snapshot = grid.getSnapshot();

    expect(snapshot.totalRowCount).toBe(3);
  });

  test("applyTransaction throws when getRowId is not provided", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
    });

    expect(() => {
      grid.applyTransaction({
        add: [{ id: "d", name: "Delta", status: "open", message: "new" }],
      });
    }).toThrow("getRowId");
  });

  test("applyTransaction added rows are sorted into position by active sort", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.setSort("name", "asc");
    grid.applyTransaction({
      add: [{ id: "d", name: "Charlie", status: "open", message: "new" }],
    });

    const snapshot = grid.getSnapshot();
    const names = snapshot.visibleRows.map((r) => (r.row as DemoRow).name);

    expect(names).toEqual(["Alpha", "Bravo", "Charlie", "Zulu"]);
  });

  test("applyTransaction invalidates snapshot cache", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    const before = grid.getSnapshot();

    grid.applyTransaction({
      update: [{ id: "a", name: "Changed" }],
    });

    const after = grid.getSnapshot();

    expect(after).not.toBe(before);
    expect(after.visibleRows.find((r) => r.id === "a")?.row).toMatchObject({
      name: "Changed",
    });
  });
});
