import { describe, expect, test } from "vitest";

import { createGridCore, type PretableProcessingOptions } from "../index";

type Row = { id: string; name: string; score: number };

// Ada and Cy deliberately share a score: grouping on it must collapse to fewer
// rows than the dataset holds, or a post-grouping count would satisfy the
// pre-grouping assertions below.
const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 3 },
];

const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid(processing?: PretableProcessingOptions) {
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
    const snapshot = grid.getSnapshot();
    // Two headers for three rows. Asserted so the fixture cannot drift back to
    // distinct scores, which would make the count below pass post-grouping.
    expect(snapshot.visibleRows).toHaveLength(2);
    expect(snapshot.matchingTotal).toEqual({ kind: "exact", count: 3 });
  });

  test("datasetKey is null before any meta is supplied", () => {
    expect(makeGrid().getSnapshot().datasetKey).toBeNull();
  });
});

describe("matchingTotal under external filter authority", () => {
  test("is unknown while no total has been supplied", () => {
    expect(
      makeGrid({ filter: "external" }).getSnapshot().matchingTotal,
    ).toEqual({ kind: "unknown" });
  });
});
