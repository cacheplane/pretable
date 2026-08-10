import { describe, expect, test } from "vitest";

import {
  createGridCore,
  deriveSelectedRows,
  type PretableCellRange,
} from "../index";

type DemoRow = {
  id: string;
  name: string;
  status: string;
  message: string;
};

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
    grid.setColumnFilter("status", { operator: "contains", value: "open" });

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

    grid.setColumnFilter("status", { operator: "contains", value: "open" });

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

/**
 * Reordering and pinning corrupt ranges with no grouping involved at all: a
 * range does not need to LOSE a column to break, it only needs the columns
 * between its endpoints to change. Every grid with row selection plus
 * drag-to-reorder is exposed, both of which shipped long before grouping.
 */
describe("selection reconciliation across reorder and pin", () => {
  function triState(grid: ReturnType<typeof makeGrid>, rowId: string) {
    const snapshot = grid.getSnapshot();

    return deriveSelectedRows({
      visibleRows: snapshot.visibleRows,
      columns: [...grid.getColumns()],
      selection: snapshot.selection,
    }).get(rowId);
  }

  test("moveColumn re-encodes a full-row range onto the new first/last", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");

    grid.moveColumn("message", 0);

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "message",
      "name",
      "status",
    ]);
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "message",
        endColumnId: "status",
      },
    ]);
    expect(triState(grid, "b")).toBe("selected");
  });

  test("toggling the same row after a reorder deselects instead of appending a second range", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");
    grid.moveColumn("message", 0);

    grid.toggleRowSelection("b");

    expect(grid.getSnapshot().selection.ranges).toEqual([]);
    expect(triState(grid, "b")).toBeUndefined();
  });

  test("setColumnOrder re-encodes a full-row range onto the new first/last", () => {
    const grid = makeGrid();
    grid.selectAll();

    grid.setColumnOrder(["message", "status", "name"]);

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "c",
        startColumnId: "message",
        endColumnId: "name",
      },
    ]);
    expect(triState(grid, "a")).toBe("selected");
    expect(triState(grid, "c")).toBe("selected");
  });

  test("setColumnPinned re-encodes a full-row range onto the new first/last", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");

    grid.setColumnPinned("message", "left");

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "message",
      "name",
      "status",
    ]);
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "message",
        endColumnId: "status",
      },
    ]);
    expect(triState(grid, "b")).toBe("selected");
  });

  test("resetColumnLayout re-encodes a full-row range onto the restored order", () => {
    const grid = makeGrid();
    grid.moveColumn("message", 0);
    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "message",
        endColumnId: "status",
      },
    ]);

    grid.resetColumnLayout();

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "name",
      "status",
      "message",
    ]);
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);
    expect(triState(grid, "b")).toBe("selected");
  });

  test("the anchor follows its range's re-encoded corner", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "b",
      columnId: "name",
    });

    grid.moveColumn("message", 0);

    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "b",
      columnId: "message",
    });
  });

  test("a partial range keeps exactly its columns when the reorder leaves them adjacent", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "b",
          endRowId: "b",
          startColumnId: "status",
          endColumnId: "message",
        },
      ],
      anchor: { rowId: "b", columnId: "status" },
    });

    // `name` leaves the front; `status` and `message` stay next to each other.
    grid.moveColumn("name", 2);

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "status",
      "message",
      "name",
    ]);
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "status",
        endColumnId: "message",
      },
    ]);
    expect(triState(grid, "b")).toBe("indeterminate");
  });

  test("a partial range a reorder would widen is dropped rather than swallowing a column", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "b",
          endRowId: "b",
          startColumnId: "status",
          endColumnId: "message",
        },
      ],
      anchor: { rowId: "b", columnId: "status" },
    });

    // `name` lands between the range's two columns.
    grid.moveColumn("name", 1);

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "status",
      "name",
      "message",
    ]);
    expect(grid.getSnapshot().selection.ranges).toEqual([]);
    expect(triState(grid, "b")).toBeUndefined();
  });

  test("a reorder that disturbs no range leaves the selection alone", () => {
    const grid = createGridCore({
      columns: [
        { id: "a", header: "A" },
        { id: "b", header: "B" },
        { id: "c", header: "C" },
        { id: "d", header: "D" },
      ],
      rows: [{ id: "r1" }] as { id: string }[],
      getRowId: (row) => row.id,
    });
    grid.selectAll();
    const before = grid.getSnapshot().selection;

    // Interior swap: neither the drawn first/last nor the range's span moves.
    grid.moveColumn("c", 1);

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(grid.getSnapshot().selection).toEqual(before);
  });
});
