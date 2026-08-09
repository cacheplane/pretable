import { describe, expect, test } from "vitest";

import {
  GROUP_COLUMN_ID,
  createGridCore,
  deriveSelectedRows,
  makeGroupId,
} from "../index";
import type {
  PretableCellAddress,
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
const ENERGY_ADA = makeGroupId([
  { columnId: "sector", value: "Energy" },
  { columnId: "analyst", value: "Ada" },
]);

function makeGrid(columns: PretableColumn<Holding>[] = COLUMNS) {
  return createGridCore<Holding>({
    columns: columns.map((column) => ({ ...column })),
    rows: HOLDINGS,
    getRowId: (row) => row.id,
  });
}

function makeGroupedSelectionGrid() {
  return createGridCore({
    columns: [
      { id: "sector", header: "Sector" },
      { id: "name", header: "Name" },
      { id: "qty", header: "Qty" },
    ],
    rows: [
      { id: "r1", sector: "Tech", name: "Ada", qty: 10 },
      { id: "r2", sector: "Energy", name: "Bob", qty: 20 },
    ],
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

function expectValidFocus(grid: ReturnType<typeof makeGrid>): void {
  const snapshot = grid.getSnapshot();
  const { rowId, columnId } = snapshot.focus;

  if (rowId === null || columnId === null) {
    expect(snapshot.focus).toEqual({ rowId: null, columnId: null });
    return;
  }

  expect(snapshot.visibleRows.some((row) => row.id === rowId)).toBe(true);
  expect(grid.getColumns().some((column) => column.id === columnId)).toBe(true);
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
        startColumnId: GROUP_COLUMN_ID,
        endColumnId: "qty",
      },
    ]);
  });

  test("a group that empties and returns keeps its override", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setGroupExpanded(SECTOR_TECH, false);

    // Every Tech row leaves: ag-grid destroys the RowNode here and with it the
    // expand state. Ours lives in an id-keyed set, so it outlives the node.
    grid.setRows(HOLDINGS.filter((row) => row.sector !== "Tech"));
    expect(ids(grid.getSnapshot().visibleRows)).toEqual([
      SECTOR_ENERGY,
      "h5",
      "h6",
      "h7",
      "h8",
    ]);
    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([
      SECTOR_TECH,
    ]);

    grid.setRows(HOLDINGS);
    const snapshot = grid.getSnapshot();

    // Tech is back, and still collapsed.
    expect(dataIds(snapshot.visibleRows)).toEqual(["h5", "h6", "h7", "h8"]);
    expect(groupById(snapshot.visibleRows, SECTOR_TECH).childCount).toBe(4);
  });
});

describe("override retention (bounded LRU over decisions)", () => {
  const churnColumns: PretableColumn<Holding>[] = [
    { id: "sector", header: "Sector" },
    { id: "analyst", header: "Analyst" },
    { id: "qty", header: "Qty", type: "number", aggregate: "sum" },
  ];

  function makeChurnGrid(limit?: number) {
    return createGridCore<Holding>({
      columns: churnColumns.map((column) => ({ ...column })),
      rows: HOLDINGS,
      getRowId: (row) => row.id,
      ...(limit === undefined ? {} : { groupExpansionOverrideLimit: limit }),
    });
  }

  const sectorId = (value: string) =>
    makeGroupId([{ columnId: "sector", value }]);

  /** One streaming tick whose grouping key has never been seen before. */
  function tick(grid: ReturnType<typeof makeChurnGrid>, n: number) {
    grid.setRows([{ id: "h1", sector: `S${n}`, analyst: "Ada", qty: 1 }]);
    grid.setGroupExpanded(sectorId(`S${n}`), false);
  }

  test("500 ticks of churning keys no longer accumulate 500 ids", () => {
    const grid = makeChurnGrid(50);
    grid.setRowGroups(["sector"]);

    for (let n = 0; n < 500; n += 1) tick(grid, n);

    const overrides = grid.getSnapshot().groupExpansionOverrides;
    expect(overrides.size).toBe(50);
    // The survivors are the newest decisions, S450…S499.
    expect(overrides.has(sectorId("S499"))).toBe(true);
    expect(overrides.has(sectorId("S450"))).toBe(true);
    expect(overrides.has(sectorId("S449"))).toBe(false);
    expect(overrides.has(sectorId("S0"))).toBe(false);
  });

  test("boundary: the limit-th decision is kept, the next one evicts the oldest", () => {
    const grid = makeChurnGrid(3);
    grid.setRowGroups(["sector"]);

    for (let n = 0; n < 3; n += 1) tick(grid, n);
    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([
      sectorId("S0"),
      sectorId("S1"),
      sectorId("S2"),
    ]);

    tick(grid, 3);
    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([
      sectorId("S1"),
      sectorId("S2"),
      sectorId("S3"),
    ]);
  });

  test("eviction is by decision age, not by absence from the flattening", () => {
    const grid = makeChurnGrid(3);
    grid.setRowGroups(["sector"]);

    // S0 is decided first, then its rows go away for the rest of the run.
    for (let n = 0; n < 3; n += 1) tick(grid, n);
    expect(grid.getSnapshot().groupExpansionOverrides.has(sectorId("S0"))).toBe(
      true,
    );

    // Two more derives with S0 absent do not touch it — only a *newer decision*
    // does. Pruning to the current flattening would have dropped it at the
    // first derive, which is the ag-grid behavior this design rejects.
    grid.setRows([{ id: "h1", sector: "S2", analyst: "Ada", qty: 1 }]);
    grid.getSnapshot();
    grid.setRows([{ id: "h1", sector: "S2", analyst: "Bob", qty: 2 }]);
    grid.getSnapshot();

    expect(grid.getSnapshot().groupExpansionOverrides.has(sectorId("S0"))).toBe(
      true,
    );
  });

  test("clearing an override frees its slot", () => {
    const grid = makeChurnGrid(2);
    grid.setRowGroups(["sector"]);

    for (let n = 0; n < 2; n += 1) tick(grid, n);
    // Re-expanding S0 removes it rather than counting against the cap.
    grid.setGroupExpanded(sectorId("S0"), true);
    tick(grid, 2);

    expect([...grid.getSnapshot().groupExpansionOverrides]).toEqual([
      sectorId("S1"),
      sectorId("S2"),
    ]);
  });

  test("Infinity opts out of the cap", () => {
    const grid = makeChurnGrid(Number.POSITIVE_INFINITY);
    grid.setRowGroups(["sector"]);

    for (let n = 0; n < 200; n += 1) tick(grid, n);

    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(200);
  });

  test("the default limit is generous enough not to bite ordinary use", () => {
    const grid = makeChurnGrid();
    grid.setRowGroups(["sector"]);

    for (let n = 0; n < 1000; n += 1) tick(grid, n);

    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(1000);
  });

  test("collapseAll stays unbounded — it clears the set and flips the default", () => {
    const grid = makeChurnGrid(2);
    grid.setRowGroups(["sector"]);
    for (let n = 0; n < 5; n += 1) tick(grid, n);

    grid.collapseAll();
    const snapshot = grid.getSnapshot();

    expect(snapshot.groupsDefaultExpanded).toBe(false);
    expect([...snapshot.groupExpansionOverrides]).toEqual([]);
    expect(ids(snapshot.visibleRows)).toEqual([sectorId("S4")]);
  });
});

describe("focus reconciliation after visible-row mutations", () => {
  test("null focus does not eagerly derive the pre-mutation visible model", () => {
    let valueCalls = 0;
    const grid = createGridCore<Holding>({
      columns: [
        {
          id: "sector",
          header: "Sector",
          rowGroup: true,
          value: (row) => {
            valueCalls += 1;
            return row.sector;
          },
        },
        { id: "qty", header: "Qty" },
      ],
      rows: HOLDINGS,
      getRowId: (row) => row.id,
    });

    grid.setRows(HOLDINGS.map((row) => ({ ...row })));

    expect(valueCalls).toBe(0);
  });

  test("setRows preserves focus on a surviving cloned group", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: SECTOR_ENERGY, columnId: GROUP_COLUMN_ID });

    grid.setRows(HOLDINGS.map((row) => ({ ...row })));

    expect(grid.getSnapshot().focus).toEqual({
      rowId: SECTOR_ENERGY,
      columnId: GROUP_COLUMN_ID,
    });
    expectValidFocus(grid);
  });

  test("applyTransaction replaces a vanished group focus at its old flat index", () => {
    const grid = createGridCore<Holding>({
      columns: COLUMNS.map((column) => ({ ...column })),
      rows: [
        { id: "a", sector: "A", analyst: "Ada", qty: 1 },
        { id: "c", sector: "C", analyst: "Bob", qty: 2 },
      ],
      getRowId: (row) => row.id,
    });
    const groupA = makeGroupId([{ columnId: "sector", value: "A" }]);
    const groupB = makeGroupId([{ columnId: "sector", value: "B" }]);
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: groupA, columnId: "qty" });

    grid.applyTransaction({ update: [{ id: "a", sector: "B" }] });

    expect(grid.getSnapshot().focus).toEqual({
      rowId: groupB,
      columnId: "qty",
    });
    expect(
      grid.getSnapshot().visibleRows.some((row) => row.id === groupA),
    ).toBe(false);
    expectValidFocus(grid);
  });

  test("setRowGroups preserves a data row and repairs its hidden column", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "h1", columnId: "sector" });

    grid.setRowGroups(["sector"]);

    expect(grid.getSnapshot().focus).toEqual({
      rowId: "h1",
      columnId: GROUP_COLUMN_ID,
    });
    expectValidFocus(grid);
  });

  test("setRowGroups clamps vanished group focus when levels are reordered", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector", "analyst"]);
    const before = grid.getSnapshot().visibleRows;
    const oldIndex = before.findIndex((row) => row.id === TECH_ADA);
    grid.setFocus({ rowId: TECH_ADA, columnId: "qty" });

    grid.setRowGroups(["analyst", "sector"]);

    const after = grid.getSnapshot().visibleRows;
    const expected = after[Math.min(oldIndex, after.length - 1)]!;
    expect(after.some((row) => row.id === TECH_ADA)).toBe(false);
    expect(grid.getSnapshot().focus).toEqual({
      rowId: expected.id,
      columnId: "qty",
    });
    expectValidFocus(grid);
  });

  test("setColumnFilter repairs focus when the focused row is filtered out", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "h5", columnId: "qty" });

    grid.setColumnFilter("sector", { operator: "equals", value: "Tech" });

    expect(grid.getSnapshot().focus).toEqual({
      rowId: "h4",
      columnId: "qty",
    });
    expectValidFocus(grid);
  });

  test("replaceFilters repairs focus and clearFilters preserves that repair", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "h1", columnId: "analyst" });

    grid.replaceFilters({
      sector: { operator: "equals", value: "Energy" },
    });

    const repaired = grid.getSnapshot().focus;
    expect(repaired).toEqual({ rowId: "h5", columnId: "analyst" });
    expectValidFocus(grid);

    grid.clearFilters();

    expect(grid.getSnapshot().focus).toEqual(repaired);
    expectValidFocus(grid);
  });

  test("collapsing an ancestor preserves the nearest surviving ancestor", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector", "analyst"]);
    grid.setFocus({ rowId: "h6", columnId: "qty" });

    grid.setGroupExpanded(ENERGY_ADA, false);

    expect(grid.getSnapshot().focus).toEqual({
      rowId: ENERGY_ADA,
      columnId: "qty",
    });
    expectValidFocus(grid);
  });

  test("visible-row mutations do not create focus from null focus", () => {
    const grid = makeGrid();

    grid.setRows(HOLDINGS.map((row) => ({ ...row })));
    expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
    grid.setColumnFilter("analyst", { operator: "equals", value: "Ada" });
    expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
    grid.setRowGroups(["sector"]);
    expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
    expectValidFocus(grid);
  });

  test("removing every visible row clears both focus fields", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "h1", columnId: "qty" });

    grid.setRows([]);

    expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
    expectValidFocus(grid);
  });

  test("an already-stale row id falls back to the first visible row", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "missing", columnId: "qty" });

    grid.setRows(HOLDINGS.map((row) => ({ ...row })));

    expect(grid.getSnapshot().focus).toEqual({ rowId: "h1", columnId: "qty" });
    expectValidFocus(grid);
  });

  test("runtime partial-null focus shapes normalize after a mutation", () => {
    const missingRow = makeGrid();
    // The public type accepts only a complete address or null. These casts
    // exercise defensive runtime normalization for malformed caller input.
    missingRow.setFocus({
      rowId: null,
      columnId: "qty",
    } as unknown as PretableCellAddress);

    missingRow.setRows(HOLDINGS.map((row) => ({ ...row })));

    expect(missingRow.getSnapshot().focus).toEqual({
      rowId: "h1",
      columnId: "qty",
    });
    expectValidFocus(missingRow);

    const missingColumn = makeGrid();
    missingColumn.setFocus({
      rowId: "h2",
      columnId: null,
    } as unknown as PretableCellAddress);

    missingColumn.applyTransaction({ update: [{ id: "h2", qty: 21 }] });

    expect(missingColumn.getSnapshot().focus).toEqual({
      rowId: "h2",
      columnId: "sector",
    });
    expectValidFocus(missingColumn);
  });
});

/**
 * The contract this suite records inverted in sub-project 2: group rows became
 * keyboard-reachable so their twisty is operable, while staying outside every
 * selection primitive. The focus assertions below are the old ones, flipped —
 * they are the clearest record of what changed.
 *
 * Grouped by sector the flat list is
 * `[ENERGY, h5, h6, h7, h8, TECH, h1, h2, h3, h4]`, and `getColumns()` is
 * `[__pretable_group__, analyst, qty]` — "sector" is hidden while it is the
 * grouping level.
 */
describe("group rows are focusable but never selectable", () => {
  test("moveFocus from null focus lands on the first row, a GROUP row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({
      rowId: SECTOR_ENERGY,
      columnId: GROUP_COLUMN_ID,
    });
  });

  test("moveFocus 'up' from null focus lands on the last row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);

    grid.moveFocus("up");

    expect(grid.getSnapshot().focus.rowId).toBe("h4");
  });

  test("moveFocus lands ON the group row between two groups", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h8", columnId: "qty" });

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus.rowId).toBe(SECTOR_TECH);
    // Vertical movement keeps the column, so focus lands on Tech's qty
    // aggregate rather than snapping to the group column.
    expect(grid.getSnapshot().focus.columnId).toBe("qty");
  });

  test("moveFocus onto a group preserves the prior data-cell selection", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h8", columnId: "qty" });
    grid.setSelection({
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h8",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    });

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({
      rowId: SECTOR_TECH,
      columnId: "qty",
    });
    expect(grid.getSnapshot().selection).toEqual({
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h8",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    });
  });

  test("extend move skips a group and extends from the original data anchor", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h8", columnId: "qty" });
    grid.setSelection({
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h8",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    });

    grid.moveFocus("down", { extend: true });

    expect(grid.getSnapshot().selection).toEqual({
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h8",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    });

    grid.moveFocus("down", { extend: true });

    expect(grid.getSnapshot().selection).toEqual({
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h1",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    });
  });

  test("clearSelection leaves no selection while a group cell is focused", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: SECTOR_ENERGY, columnId: GROUP_COLUMN_ID });
    grid.selectAll();

    grid.clearSelection();

    expect(grid.getSnapshot().selection).toEqual({
      ranges: [],
      anchor: null,
    });
  });

  test("clearSelection preserves an unknown focus address", () => {
    const grid = makeGrid();
    grid.selectAll();
    grid.setFocus({ rowId: "not-a-visible-row", columnId: "qty" });

    grid.clearSelection();

    expect(grid.getSnapshot().selection).toEqual({
      ranges: [
        {
          startRowId: "not-a-visible-row",
          endRowId: "not-a-visible-row",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "not-a-visible-row", columnId: "qty" },
    });
  });

  test("clearSelection derives selection from focus repaired by filtering", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "h5", columnId: "qty" });
    grid.setColumnFilter("sector", { operator: "contains", value: "Tech" });

    expect(grid.getSnapshot().focus).toEqual({ rowId: "h4", columnId: "qty" });

    grid.clearSelection();

    expect(grid.getSnapshot().selection).toEqual({
      ranges: [
        {
          startRowId: "h4",
          endRowId: "h4",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h4", columnId: "qty" },
    });
  });

  test("jumpToEdge 'up' lands on the outermost group row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h1", columnId: "qty" });

    grid.moveFocus("up", { jumpToEdge: true });
    expect(grid.getSnapshot().focus.rowId).toBe(SECTOR_ENERGY);

    grid.moveFocus("down", { jumpToEdge: true });
    expect(grid.getSnapshot().focus.rowId).toBe("h4");
  });

  test("focus survives collapsing every group by moving to a group row", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.setFocus({ rowId: "h1", columnId: "qty" });
    grid.collapseAll();

    // h1 is gone; focus re-anchored to its surviving ancestor rather than
    // dangling, so this is a clamp at the last row, not a teleport to row 0.
    expect(grid.getSnapshot().focus.rowId).toBe(SECTOR_TECH);

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus.rowId).toBe(SECTOR_TECH);
  });

  test("moveFocus clears focus when there are no visible rows at all", () => {
    const grid = createGridCore<Holding>({
      columns: COLUMNS.map((column) => ({ ...column })),
      rows: [],
      getRowId: (row) => row.id,
    });
    grid.setRowGroups(["sector"]);

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
        startColumnId: GROUP_COLUMN_ID,
        endColumnId: "qty",
      },
    ]);
  });

  test("selectAll spans the effective grouped columns", () => {
    const grid = makeGroupedSelectionGrid();
    grid.setRowGroups(["sector"]);
    const effectiveColumns = grid.getColumns();
    const firstColumn = effectiveColumns[0]!;
    const lastColumn = effectiveColumns[effectiveColumns.length - 1]!;
    expect([firstColumn.id, lastColumn.id]).toEqual([GROUP_COLUMN_ID, "qty"]);

    grid.selectAll();

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "r2",
        endRowId: "r1",
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      },
    ]);
  });

  test("toggleRowSelection spans the effective grouped columns", () => {
    const grid = makeGroupedSelectionGrid();
    grid.setRowGroups(["sector"]);
    const effectiveColumns = grid.getColumns();
    const firstColumn = effectiveColumns[0]!;
    const lastColumn = effectiveColumns[effectiveColumns.length - 1]!;
    expect([firstColumn.id, lastColumn.id]).toEqual([GROUP_COLUMN_ID, "qty"]);

    grid.toggleRowSelection("r1");

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "r1",
        endRowId: "r1",
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      },
    ]);
  });

  test("toggleRowSelection ignores visible group ids but accepts unknown ids", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    const priorSelection = {
      ranges: [
        {
          startRowId: "h8",
          endRowId: "h8",
          startColumnId: "qty",
          endColumnId: "qty",
        },
      ],
      anchor: { rowId: "h8", columnId: "qty" },
    };
    grid.setSelection(priorSelection);
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });

    grid.toggleRowSelection(SECTOR_ENERGY);
    expect(grid.getSnapshot().selection).toEqual(priorSelection);
    expect(emits).toBe(0);

    grid.toggleRowSelection("not-a-visible-row");
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "h8",
        endRowId: "h8",
        startColumnId: "qty",
        endColumnId: "qty",
      },
      {
        startRowId: "not-a-visible-row",
        endRowId: "not-a-visible-row",
        startColumnId: GROUP_COLUMN_ID,
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
    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startColumnId: GROUP_COLUMN_ID,
          endColumnId: "qty",
        }),
      ]),
    );
  });

  test("setSelectAllVisible spans the effective grouped columns", () => {
    const grid = makeGroupedSelectionGrid();
    grid.setRowGroups(["sector"]);
    const effectiveColumns = grid.getColumns();
    const firstColumn = effectiveColumns[0]!;
    const lastColumn = effectiveColumns[effectiveColumns.length - 1]!;
    expect([firstColumn.id, lastColumn.id]).toEqual([GROUP_COLUMN_ID, "qty"]);

    grid.setSelectAllVisible(true);

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "r2",
        endRowId: "r2",
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      },
      {
        startRowId: "r1",
        endRowId: "r1",
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      },
    ]);
  });

  test("deriveSelectedRows never reports a group row as selected", () => {
    const grid = makeGrid();
    grid.setRowGroups(["sector"]);
    grid.selectAll();
    const snapshot = grid.getSnapshot();

    const selected = deriveSelectedRows({
      visibleRows: snapshot.visibleRows,
      columns: [...grid.getColumns()],
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
