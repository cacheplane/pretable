import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 2 },
];

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid(processing?: {
  filter?: "engine" | "external";
  sort?: "engine" | "external";
}) {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
    processing,
  });
}

describe("matchingTotal under engine filter authority", () => {
  test("is the exact loaded count when nothing is filtered", () => {
    expect(makeGrid().getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
  });

  test("is the exact post-filter count", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 1,
    });
  });

  test("is pre-grouping: collapsed branches do not reduce it", () => {
    const grid = makeGrid();
    grid.setRowGroups(["score"]);
    grid.collapseAll();
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
  });

  test("datasetKey is null before any meta is supplied", () => {
    expect(makeGrid().getSnapshot().datasetKey).toBeNull();
  });
});
