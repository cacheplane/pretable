import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import { GROUP_COLUMN_ID } from "../group-column";

type Row = { id: string; sector: string; name: string; qty: number };

const columns = [
  { id: "sector", header: "Sector" },
  { id: "name", header: "Name" },
  { id: "qty", header: "Qty" },
];

const rows: Row[] = [
  { id: "r1", sector: "Tech", name: "a", qty: 1 },
  { id: "r2", sector: "Tech", name: "b", qty: 2 },
  { id: "r3", sector: "Energy", name: "c", qty: 3 },
];

const make = (options = {}) =>
  createGridCore<Row>({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
    ...options,
  });

describe("derived group column", () => {
  test("ungrouped: getColumns() is exactly the consumer's columns", () => {
    const grid = make();
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      "sector",
      "name",
      "qty",
    ]);
  });

  test("grouped: prepends the group column and hides the grouped column", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });

  test("ungrouping restores the original list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    grid.setRowGroups([]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      "sector",
      "name",
      "qty",
    ]);
  });

  test("hideGroupedColumns: false keeps the grouped column visible", () => {
    const grid = make({ hideGroupedColumns: false });
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "sector",
      "name",
      "qty",
    ]);
  });

  test("multi-level grouping hides every grouped column, one group column", () => {
    const grid = make();
    grid.setRowGroups(["sector", "name"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "qty",
    ]);
  });

  test("groupColumn config overrides header and width", () => {
    const grid = make({ groupColumn: { header: "Bucket", widthPx: 320 } });
    grid.setRowGroups(["sector"]);
    const col = grid.getColumns()[0]!;
    expect(col.id).toBe(GROUP_COLUMN_ID);
    expect(col.header).toBe("Bucket");
    expect(col.widthPx).toBe(320);
  });

  test("default header comes from the first grouped column", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()[0]!.header).toBe("Sector");
  });

  test("the group column is not sortable or filterable", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const col = grid.getColumns()[0]!;
    expect(col.sortable).toBe(false);
    expect(col.filterable).toBe(false);
  });

  test("the group column is not pinned by default", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()[0]!.pinned).toBeUndefined();
  });

  test("groupColumn.pinned seats it in the left-pinned region", () => {
    const grid = make({ groupColumn: { pinned: "left" } });
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()[0]!.pinned).toBe("left");
  });

  test("an unpinned group column still leads its own region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "sector", header: "Sector" },
        { id: "name", header: "Name", pinned: "left" },
        { id: "qty", header: "Qty" },
      ],
      rows,
      getRowId: (row) => row.id,
    });
    grid.setRowGroups(["sector"]);
    // [left…] then [unpinned…]; the synthetic column heads the unpinned run,
    // exactly as the row-select column does.
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      "name",
      GROUP_COLUMN_ID,
      "qty",
    ]);
  });

  // The bug this whole design exists to prevent: a prop identity change used to
  // rebuild options.columns from the consumer's array, dropping any synthetic
  // column. Deriving on read makes that structurally impossible.
  test("survives mergeColumnsFromProps with a fresh array identity", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    grid.mergeColumnsFromProps([...columns]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });

  test("getColumns() is referentially stable until something invalidates it", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()).toBe(grid.getColumns());
  });

  test("setRowGroups invalidates the cached list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const before = grid.getColumns();
    grid.setRowGroups(["name"]);
    expect(grid.getColumns()).not.toBe(before);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "sector",
      "qty",
    ]);
  });

  test("column mutations invalidate the cached list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const before = grid.getColumns();
    grid.setColumnWidth("qty", 999);
    expect(grid.getColumns()).not.toBe(before);
    expect(grid.getColumns().find((c) => c.id === "qty")?.widthPx).toBe(999);
  });
});
