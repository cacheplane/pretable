import { describe, expect, test } from "vitest";

import { createGridCore, deriveSelectedRows, makeGroupId } from "../index";
import type {
  PretableColumn,
  PretableDataRow,
  PretableGroupRow,
  PretableRow,
  PretableVisibleRow,
} from "../types";

interface Holding extends PretableRow {
  id: string;
  sector: string;
  analyst: string;
  qty: number;
}

const HOLDINGS: Holding[] = [
  { id: "h1", sector: "Tech", analyst: "Ada", qty: 10 },
  { id: "h2", sector: "Tech", analyst: "Ada", qty: 20 },
  { id: "h3", sector: "Tech", analyst: "Ada", qty: 30 },
  { id: "h4", sector: "Tech", analyst: "Bob", qty: 100 },
  { id: "h5", sector: "Energy", analyst: "Ada", qty: 1 },
  { id: "h6", sector: "Energy", analyst: "Ada", qty: 2 },
  { id: "h7", sector: "Energy", analyst: "Bob", qty: 7 },
  { id: "h8", sector: "Energy", analyst: "Bob", qty: 8 },
];

const COLUMNS: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector" },
  { id: "analyst", header: "Analyst" },
  { id: "qty", header: "Qty", type: "number", aggregate: "sum" },
];

const SECTOR_TECH = makeGroupId([{ columnId: "sector", value: "Tech" }]);
const SECTOR_ENERGY = makeGroupId([{ columnId: "sector", value: "Energy" }]);
const TECH_ADA = makeGroupId([
  { columnId: "sector", value: "Tech" },
  { columnId: "analyst", value: "Ada" },
]);

function makeGrid(columns: PretableColumn<Holding>[] = COLUMNS) {
  return createGridCore<Holding>({
    columns: columns.map((column) => ({ ...column })),
    rows: HOLDINGS,
    getRowId: (row) => row.id,
  });
}

function ids(entries: PretableVisibleRow<Holding>[]): string[] {
  return entries.map((entry) => entry.id);
}

function dataIds(entries: PretableVisibleRow<Holding>[]): string[] {
  return entries
    .filter((entry): entry is PretableDataRow<Holding> => entry.kind === "data")
    .map((entry) => entry.id);
}

function groupById(
  entries: PretableVisibleRow<Holding>[],
  id: string,
): PretableGroupRow {
  const found = entries.find(
    (entry): entry is PretableGroupRow =>
      entry.kind === "group" && entry.id === id,
  );
  if (!found) throw new Error(`no group row with id ${id}`);
  return found;
}

describe("setRowGroups", () => {
  test("groups the visible rows and reflects the levels in the snapshot", () => {
    const grid = makeGrid();

    grid.setRowGroups(["sector"]);
    const snapshot = grid.getSnapshot();

    expect(snapshot.rowGroups).toEqual(["sector"]);
    expect(ids(snapshot.visibleRows)).toEqual([
      SECTOR_ENERGY,
      "h5",
      "h6",
      "h7",
      "h8",
      SECTOR_TECH,
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
  });

  test("[] clears grouping back to the flat row list", () => {
    const grid = makeGrid();

    grid.setRowGroups(["sector"]);
    grid.setRowGroups([]);
    const snapshot = grid.getSnapshot();

    expect(snapshot.rowGroups).toEqual([]);
    expect(ids(snapshot.visibleRows)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "h7",
      "h8",
    ]);
  });

  test("drops unknown column ids and duplicates", () => {
    const grid = makeGrid();

    grid.setRowGroups(["nope", "sector", "sector", "also-nope"]);

    expect(grid.getSnapshot().rowGroups).toEqual(["sector"]);
  });

  test("is change-guarded — an equal request keeps the same snapshot", () => {
    const grid = makeGrid();

    grid.setRowGroups(["sector"]);
    const first = grid.getSnapshot();
    grid.setRowGroups(["sector"]);

    expect(grid.getSnapshot()).toBe(first);
  });

  test("an all-unknown request on an ungrouped grid is a no-op", () => {
    const grid = makeGrid();

    const first = grid.getSnapshot();
    grid.setRowGroups(["nope"]);

    expect(grid.getSnapshot()).toBe(first);
  });

  test("snapshot.rowGroups is a defensive copy of engine state", () => {
    const grid = makeGrid();

    grid.setRowGroups(["sector"]);
    grid.getSnapshot().rowGroups.push("analyst");

    // Force a fresh snapshot: the cached object is the caller's to corrupt,
    // but the engine's own levels must be untouched.
    grid.setViewport({ scrollTop: 1, scrollLeft: 0, height: 100, width: 100 });
    const snapshot = grid.getSnapshot();

    expect(snapshot.rowGroups).toEqual(["sector"]);
    expect(
      snapshot.visibleRows.filter((entry) => entry.kind === "group"),
    ).toHaveLength(2);
  });

  test("initializes from columns declaring rowGroup: true, in column order", () => {
    const grid = makeGrid([
      { id: "sector", header: "Sector", rowGroup: true },
      { id: "analyst", header: "Analyst", rowGroup: true },
      { id: "qty", header: "Qty", type: "number", aggregate: "sum" },
    ]);

    const snapshot = grid.getSnapshot();

    expect(snapshot.rowGroups).toEqual(["sector", "analyst"]);
    expect(snapshot.visibleRows[0]!.kind).toBe("group");
  });
});

describe("expand/collapse", () => {
  test("setGroupExpanded(false) hides the group's children", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.setGroupExpanded(SECTOR_TECH, false);
    const snapshot = grid.getSnapshot();

    expect(dataIds(snapshot.visibleRows)).toEqual(["h5", "h6", "h7", "h8"]);
    expect([...snapshot.groupExpansionOverrides]).toEqual([SECTOR_TECH]);
    expect(snapshot.groupsDefaultExpanded).toBe(true);
    // The group row itself stays, with a post-filter child count.
    expect(groupById(snapshot.visibleRows, SECTOR_TECH).childCount).toBe(4);
  });

  test("toggleGroup flips expansion and clears the override again", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.toggleGroup(SECTOR_TECH);
    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([
      SECTOR_TECH,
    ]);

    grid.toggleGroup(SECTOR_TECH);
    const snapshot = grid.getSnapshot();
    expect([...snapshot.groupExpansionOverrides]).toEqual([]);
    expect(dataIds(snapshot.visibleRows)).toHaveLength(8);
  });

  test("setGroupExpanded is change-guarded", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    const first = grid.getSnapshot();
    grid.setGroupExpanded(SECTOR_TECH, true);

    expect(grid.getSnapshot()).toBe(first);
  });

  test("collapseAll flips the default and drops per-group overrides", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setGroupExpanded(SECTOR_TECH, false);

    grid.collapseAll();
    const snapshot = grid.getSnapshot();

    expect(snapshot.groupsDefaultExpanded).toBe(false);
    expect([...snapshot.groupExpansionOverrides]).toEqual([]);
    expect(ids(snapshot.visibleRows)).toEqual([SECTOR_ENERGY, SECTOR_TECH]);
  });

  test("with the default collapsed, an override means EXPANDED", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.collapseAll();

    grid.setGroupExpanded(SECTOR_TECH, true);
    const snapshot = grid.getSnapshot();

    expect([...snapshot.groupExpansionOverrides]).toEqual([SECTOR_TECH]);
    expect(dataIds(snapshot.visibleRows)).toEqual(["h1", "h2", "h3", "h4"]);
  });

  test("expandAll restores the expanded default and drops overrides", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.collapseAll();
    grid.setGroupExpanded(SECTOR_TECH, true);

    grid.expandAll();
    const snapshot = grid.getSnapshot();

    expect(snapshot.groupsDefaultExpanded).toBe(true);
    expect([...snapshot.groupExpansionOverrides]).toEqual([]);
    expect(dataIds(snapshot.visibleRows)).toHaveLength(8);
  });

  test("expandAll is change-guarded when already fully expanded", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    const first = grid.getSnapshot();
    grid.expandAll();

    expect(grid.getSnapshot()).toBe(first);
  });

  test("an override for a group that does not exist is inert", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.setGroupExpanded(TECH_ADA, false);

    expect(dataIds(grid.getSnapshot().visibleRows)).toHaveLength(8);
  });

  test("overrides are pruned when the grouping changes", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setGroupExpanded(SECTOR_TECH, false);

    grid.setRowGroups(["analyst"]);

    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([]);
  });

  test("snapshot.groupExpansionOverrides is a defensive copy of engine state", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setGroupExpanded(SECTOR_TECH, false);

    (grid.getSnapshot().groupExpansionOverrides as Set<string>).clear();

    grid.setViewport({ scrollTop: 1, scrollLeft: 0, height: 100, width: 100 });
    const snapshot = grid.getSnapshot();

    expect([...snapshot.groupExpansionOverrides]).toEqual([SECTOR_TECH]);
    expect(dataIds(snapshot.visibleRows)).toEqual(["h5", "h6", "h7", "h8"]);
  });
});

describe("derived-row cache invalidation", () => {
  test("re-derives when the grouping levels change", () => {
    const grid = makeGrid();

    const flat = grid.getSnapshot().visibleRows;
    grid.setRowGroups(["sector"]);

    expect(grid.getSnapshot().visibleRows).not.toBe(flat);
    expect(grid.getSnapshot().visibleRows.some((r) => r.kind === "group")).toBe(
      true,
    );
  });

  test("re-derives when an expansion override changes", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const before = grid.getSnapshot().visibleRows;

    grid.setGroupExpanded(SECTOR_TECH, false);

    expect(grid.getSnapshot().visibleRows).not.toBe(before);
  });

  test("re-derives when the expansion default flips", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const before = grid.getSnapshot().visibleRows;

    grid.collapseAll();

    expect(grid.getSnapshot().visibleRows).not.toBe(before);
  });

  test("reuses the derived rows when nothing relevant changed", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const before = grid.getSnapshot().visibleRows;

    grid.setViewport({ scrollTop: 40, scrollLeft: 0, height: 300, width: 500 });

    expect(grid.getSnapshot().visibleRows).toBe(before);
  });
});

describe("aggregateFilteredRows", () => {
  test("defaults to aggregating only rows that pass the filter", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setColumnFilter("analyst", { operator: "equals", value: "Ada" });

    const tech = groupById(grid.getSnapshot().visibleRows, SECTOR_TECH);

    expect(tech.childCount).toBe(3);
    expect(tech.aggregates.qty).toBe(60);
  });

  test("when enabled, aggregates fold over filtered-out rows too", () => {
    const grid = createGridCore<Holding>({
      columns: COLUMNS.map((column) => ({ ...column })),
      rows: HOLDINGS,
      getRowId: (row) => row.id,
      aggregateFilteredRows: true,
    });
    grid.setRowGroups(["sector"]);
    grid.setColumnFilter("analyst", { operator: "equals", value: "Ada" });

    const tech = groupById(grid.getSnapshot().visibleRows, SECTOR_TECH);

    // childCount stays post-filter; the aggregate spans all four Tech rows.
    expect(tech.childCount).toBe(3);
    expect(tech.aggregates.qty).toBe(160);
  });
});

describe("streaming", () => {
  test("guard rail: a changed grouping key re-paths the row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.applyTransaction({ update: [{ id: "h1", sector: "Energy" }] });
    const snapshot = grid.getSnapshot();

    expect(ids(snapshot.visibleRows)).toEqual([
      SECTOR_ENERGY,
      "h1",
      "h5",
      "h6",
      "h7",
      "h8",
      SECTOR_TECH,
      "h2",
      "h3",
      "h4",
    ]);
    expect(groupById(snapshot.visibleRows, SECTOR_ENERGY).childCount).toBe(5);
    expect(groupById(snapshot.visibleRows, SECTOR_TECH).childCount).toBe(3);
  });

  test("unchanged aggregates keep their object identity across a recompute", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const first = grid.getSnapshot().visibleRows;
    const techBefore = groupById(first, SECTOR_TECH).aggregates;
    const energyBefore = groupById(first, SECTOR_ENERGY).aggregates;

    // A fresh row array with identical values forces a full re-derive.
    grid.setRows(HOLDINGS.map((row) => ({ ...row })));
    const second = grid.getSnapshot().visibleRows;

    expect(second).not.toBe(first);
    expect(groupById(second, SECTOR_TECH).aggregates).toBe(techBefore);
    expect(groupById(second, SECTOR_ENERGY).aggregates).toBe(energyBefore);
  });

  test("a changed aggregate value yields a new object, and only for that group", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const first = grid.getSnapshot().visibleRows;
    const techBefore = groupById(first, SECTOR_TECH).aggregates;
    const energyBefore = groupById(first, SECTOR_ENERGY).aggregates;

    grid.applyTransaction({ update: [{ id: "h5", qty: 999 }] });
    const second = grid.getSnapshot().visibleRows;

    expect(groupById(second, SECTOR_ENERGY).aggregates).not.toBe(energyBefore);
    expect(groupById(second, SECTOR_ENERGY).aggregates.qty).toBe(1016);
    expect(groupById(second, SECTOR_TECH).aggregates).toBe(techBefore);
  });

  test("selection and focus survive a grouped tick update", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h5", columnId: "qty" });
    grid.toggleRowSelection("h5");

    grid.applyTransaction({ update: [{ id: "h5", qty: 42 }] });
    const snapshot = grid.getSnapshot();

    expect(snapshot.focus).toEqual({ rowId: "h5", columnId: "qty" });
    expect(snapshot.selection.ranges).toEqual([
      {
        startRowId: "h5",
        endRowId: "h5",
        startColumnId: "sector",
        endColumnId: "qty",
      },
    ]);
  });
});

describe("group rows are neither focusable nor selectable (v1)", () => {
  test("moveFocus from null focus lands on the first DATA row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({
      rowId: "h5",
      columnId: "sector",
    });
  });

  test("moveFocus 'up' from null focus lands on the last DATA row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.moveFocus("up");

    expect(grid.getSnapshot().focus.rowId).toBe("h4");
  });

  test("moveFocus steps over the group row between two groups", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h8", columnId: "sector" });

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus.rowId).toBe("h1");
  });

  test("jumpToEdge lands on data rows, not on the outermost group row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h1", columnId: "sector" });

    grid.moveFocus("up", { jumpToEdge: true });
    expect(grid.getSnapshot().focus.rowId).toBe("h5");

    grid.moveFocus("down", { jumpToEdge: true });
    expect(grid.getSnapshot().focus.rowId).toBe("h4");
  });

  test("moveFocus clears focus when every group is collapsed", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h1", columnId: "sector" });
    grid.collapseAll();

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
  });

  test("selectAll spans the first and last DATA rows", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.selectAll();

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "h5",
        endRowId: "h4",
        startColumnId: "sector",
        endColumnId: "qty",
      },
    ]);
  });

  test("selectAll is a no-op when only group rows are visible", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.collapseAll();

    grid.selectAll();

    expect(grid.getSnapshot().selection.ranges).toEqual([]);
  });

  test("setSelectAllVisible covers data rows only", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.setSelectAllVisible(true);
    const { ranges } = grid.getSnapshot().selection;

    expect(ranges).toHaveLength(8);
    expect(ranges.map((range) => range.startRowId)).toEqual([
      "h5",
      "h6",
      "h7",
      "h8",
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
  });

  test("deriveSelectedRows never reports a group row as selected", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.selectAll();
    const snapshot = grid.getSnapshot();

    const selected = deriveSelectedRows({
      visibleRows: snapshot.visibleRows,
      columns: grid.options.columns,
      selection: snapshot.selection,
    });

    expect([...selected.keys()].sort()).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "h7",
      "h8",
    ]);
  });
});
