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
