import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface DemoRow {
  id: string;
  name: string;
  status: string;
}

const columns = [
  { id: "name", header: "Name" },
  { id: "status", header: "Status" },
] as const;

const rows: DemoRow[] = [
  { id: "a", name: "Zulu", status: "open" },
  { id: "b", name: "Alpha", status: "open" },
  { id: "c", name: "Bravo", status: "closed" },
];

function createInstrumentedGrid() {
  const grid = createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
  let emits = 0;
  grid.subscribe(() => {
    emits += 1;
  });

  return {
    grid,
    get emits() {
      return emits;
    },
    reset() {
      emits = 0;
    },
  };
}

describe("grid-core derivation caching", () => {
  test("focus change reuses the same visibleRows reference", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.setSort("name", "asc");
    const before = grid.getSnapshot().visibleRows;

    grid.setFocus("b", "name");

    expect(grid.getSnapshot().visibleRows).toBe(before);
  });

  test("selection change reuses the same visibleRows reference", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    grid.setFilter("status", "open");
    const before = grid.getSnapshot().visibleRows;

    grid.selectRow("a");

    expect(grid.getSnapshot().visibleRows).toBe(before);
  });

  test("viewport scroll reuses the same visibleRows reference", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    const before = grid.getSnapshot().visibleRows;

    grid.setViewport({ scrollTop: 250, height: 400 });

    expect(grid.getSnapshot().visibleRows).toBe(before);
  });

  test("sort change produces a new visibleRows reference", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    const before = grid.getSnapshot().visibleRows;

    grid.setSort("name", "asc");

    expect(grid.getSnapshot().visibleRows).not.toBe(before);
  });

  test("filter change produces a new visibleRows reference", () => {
    const grid = createGridCore({
      columns: [...columns],
      rows,
      getRowId: (row) => row.id,
    });

    const before = grid.getSnapshot().visibleRows;

    grid.setFilter("status", "open");

    expect(grid.getSnapshot().visibleRows).not.toBe(before);
  });
});

describe("grid-core emit behavior", () => {
  test("setSort with identical state does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.setSort("name", "asc");
    instrumented.reset();

    instrumented.grid.setSort("name", "asc");

    expect(instrumented.emits).toBe(0);
  });

  test("setSort with new direction emits exactly once", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.setSort("name", "asc");
    instrumented.reset();

    instrumented.grid.setSort("name", "desc");

    expect(instrumented.emits).toBe(1);
  });

  test("setFilter with identical value does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.setFilter("status", "open");
    instrumented.reset();

    instrumented.grid.setFilter("status", "open");

    expect(instrumented.emits).toBe(0);
  });

  test("clearFilters with already empty filters does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.clearFilters();

    expect(instrumented.emits).toBe(0);
  });

  test("setFocus with identical rowId and columnId does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.setFocus("b", "name");
    instrumented.reset();

    instrumented.grid.setFocus("b", "name");

    expect(instrumented.emits).toBe(0);
  });

  test("selectRow with identical rowId does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.selectRow("b");
    instrumented.reset();

    instrumented.grid.selectRow("b");

    expect(instrumented.emits).toBe(0);
  });

  test("setViewport with identical state does not emit", () => {
    const instrumented = createInstrumentedGrid();

    instrumented.grid.setViewport({ scrollTop: 200, height: 400 });
    instrumented.reset();

    instrumented.grid.setViewport({ scrollTop: 200, height: 400 });

    expect(instrumented.emits).toBe(0);
  });
});
