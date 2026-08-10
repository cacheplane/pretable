import { describe, expect, test, vi } from "vitest";

import { resetDevWarnings } from "../dev-warn";
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

describe("result meta under external filter authority", () => {
  test("setRows carries the total in the same emit as the rows", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setRows(rows.slice(0, 2), { total: { kind: "exact", count: 4120 } });
    const snap = grid.getSnapshot();
    expect(emits).toBe(1);
    expect(snap.loadedRowCount).toBe(2);
    expect(snap.matchingTotal).toEqual({ kind: "exact", count: 4120 });
  });

  test("matchingTotal is unknown until a total is supplied", () => {
    expect(
      makeGrid({ filter: "external", sort: "external" }).getSnapshot()
        .matchingTotal,
    ).toEqual({ kind: "unknown" });
  });

  test("setResultMeta refines the total without a rows replacement", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { total: { kind: "estimate", count: 5000 } });
    const rowsBefore = grid.getSnapshot().visibleRows;
    grid.setResultMeta({ total: { kind: "exact", count: 5032 } });
    const snap = grid.getSnapshot();
    expect(snap.matchingTotal).toEqual({ kind: "exact", count: 5032 });
    expect(snap.visibleRows).toEqual(rowsBefore);
  });

  test("setResultMeta with an unchanged total does not emit", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { total: { kind: "exact", count: 9 } });
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setResultMeta({ total: { kind: "exact", count: 9 } });
    expect(emits).toBe(0);
  });

  test("appending is setRows(prev.concat(page)) and preserves selection", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRows(rows.slice(0, 2), { total: { kind: "exact", count: 3 } });
    grid.toggleRowSelection("a");
    grid.setRows(rows, { total: { kind: "exact", count: 3 } });
    const snap = grid.getSnapshot();
    expect(snap.loadedRowCount).toBe(3);
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.selection.ranges[0]!.startRowId).toBe("a");
  });

  test("a supplied total under engine filter authority is ignored, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const grid = makeGrid();
    grid.setRows(rows, { total: { kind: "exact", count: 999 } });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("resultMeta.total");
    warn.mockRestore();
  });
});
