import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface Row {
  id: string;
  name: string;
}

const columns = [{ id: "name", header: "Name" }];
const getRowId = (row: Row) => row.id;

function makeGrid(rows: Row[]) {
  return createGridCore<Row>({ columns: [...columns], rows, getRowId });
}

describe("setRows", () => {
  test("replaces row data while preserving selection and focus", () => {
    const grid = makeGrid([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    const selectionBefore = grid.getSnapshot().selection;
    expect(selectionBefore.ranges.length).toBe(1);

    // A new array with the same ids but updated row data — the streaming case.
    grid.setRows([
      { id: "a", name: "A2" },
      { id: "b", name: "B2" },
    ]);

    const snap = grid.getSnapshot();
    expect(snap.selection).toEqual(selectionBefore);
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
    expect(snap.visibleRows.find((r) => r.id === "a")?.row.name).toBe("A2");
    expect(snap.totalRowCount).toBe(2);
  });

  test("prunes selection, focus, and edits for rows that no longer exist", () => {
    const grid = makeGrid([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.beginEdit({ rowId: "a", columnId: "name" });

    grid.setRows([{ id: "b", name: "B" }]); // "a" removed

    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.focus).toEqual({ rowId: null, columnId: null });
    expect(snap.editing).toBeNull();
    expect(snap.totalRowCount).toBe(1);
  });

  test("notifies subscribers once", () => {
    const grid = makeGrid([{ id: "a", name: "A" }]);
    let calls = 0;
    grid.subscribe(() => {
      calls += 1;
    });
    grid.setRows([{ id: "a", name: "A2" }]);
    expect(calls).toBe(1);
  });
});
