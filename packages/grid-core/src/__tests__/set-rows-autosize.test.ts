import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface DemoRow {
  id: string;
  name: string;
}

const columns = [{ id: "name", header: "Name" }] as const;

function emptyAutosizedGrid() {
  return createGridCore<DemoRow>({
    columns: columns.map((c) => ({ ...c })),
    rows: [],
    getRowId: (row) => row.id,
    autosize: true,
  });
}

const LONG_ROW: DemoRow[] = [
  { id: "a", name: "a value far longer than the header text" },
];

function widthOf(grid: ReturnType<typeof emptyAutosizedGrid>): number | undefined {
  return grid.options.columns.find((c) => c.id === "name")?.widthPx;
}

describe("setRows + autosize", () => {
  test("measures columns when rows arrive after an empty first render", () => {
    // Fetch-then-render is the usual order, so the first pass sees no rows and
    // autosize can only fall back to its minimum. Without re-measuring, the
    // grid keeps that minimum for the rest of its life.
    const grid = emptyAutosizedGrid();
    const whileEmpty = widthOf(grid);

    grid.setRows(LONG_ROW);

    expect(widthOf(grid)).toBeGreaterThan(whileEmpty ?? 0);
  });

  test("does not clobber a width the consumer set", () => {
    const grid = emptyAutosizedGrid();
    grid.setColumnWidth("name", 321);

    grid.setRows(LONG_ROW);

    expect(widthOf(grid)).toBe(321);
  });

  test("leaves widths alone when autosize is off", () => {
    const grid = createGridCore<DemoRow>({
      columns: columns.map((c) => ({ ...c })),
      rows: [],
      getRowId: (row) => row.id,
    });

    grid.setRows(LONG_ROW);

    expect(grid.options.columns.find((c) => c.id === "name")?.widthPx).toBe(
      undefined,
    );
  });
});
