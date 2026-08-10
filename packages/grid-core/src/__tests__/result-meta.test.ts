import { describe, expect, test, vi } from "vitest";

import { resetDevWarnings } from "../warn-once";
import {
  createGridCore,
  type PretableProcessingOptions,
  type PretableResultMeta,
} from "../index";

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
    const loaded = rows.slice(0, 2);
    grid.setRows(loaded, { total: { kind: "exact", count: 3 } });
    grid.toggleRowSelection("a");
    grid.setRows(loaded.concat(rows.slice(2)), {
      total: { kind: "exact", count: 3 },
    });
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

  // `setRows` and `setResultMeta` spell the authority rule out separately, so
  // the setRows coverage above does not protect this path.
  test("setResultMeta under engine filter authority is ignored, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();
    const grid = makeGrid();
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setResultMeta({ total: { kind: "exact", count: 999 } });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 3,
    });
    // A refused total must not reach the state either: storing it would emit,
    // repainting every subscriber for a value the snapshot cannot show.
    expect(emits).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("resultMeta.total");
    warn.mockRestore();
  });

  // A polling consumer that reuses one meta object across ticks is the natural
  // shape for a 2 s refresh. Aliasing the caller's object would let it write
  // engine state directly, and would then read back as "unchanged".
  test("a supplied total is copied, not aliased", () => {
    const grid = makeGrid({ filter: "external" });
    const total = { kind: "exact" as const, count: 10 };
    grid.setRows(rows, { total });
    total.count = 999;
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 10,
    });
  });

  test("a mutated-and-resubmitted total emits", () => {
    const grid = makeGrid({ filter: "external" });
    const meta = { total: { kind: "exact" as const, count: 10 } };
    grid.setRows(rows, meta);
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    meta.total.count = 11;
    grid.setResultMeta(meta);
    expect(emits).toBe(1);
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 11,
    });
  });

  // The same reuse hazard on the path that never passes meta to `setRows`:
  // rows stream in unannotated and only the total is refined on a tick.
  test("a total resubmitted through setResultMeta alone emits", () => {
    const grid = makeGrid({ filter: "external" });
    const meta = { total: { kind: "exact" as const, count: 10 } };
    grid.setResultMeta(meta);
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    meta.total.count = 11;
    grid.setResultMeta(meta);
    expect(emits).toBe(1);
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 11,
    });
  });

  test("mutating the snapshot's matchingTotal does not reach engine state", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { total: { kind: "exact", count: 10 } });
    const exposed = grid.getSnapshot().matchingTotal as { count: number };
    exposed.count = 999;
    grid.setResultMeta({ datasetKey: "next" });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 10,
    });
  });

  test("a growing atLeast lower bound emits", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setResultMeta({ total: { kind: "unknown", atLeast: 200 } });
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setResultMeta({ total: { kind: "unknown", atLeast: 400 } });
    expect(emits).toBe(1);
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "unknown",
      atLeast: 400,
    });
  });
});

describe("datasetKey", () => {
  function externalGrid() {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRows(rows, {
      datasetKey: "q1",
      total: { kind: "exact", count: 3 },
    });
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.beginEdit({ rowId: "b", columnId: "name" });
    return grid;
  }

  test("the first key is an assignment, not a pivot", () => {
    const grid = makeGrid({ filter: "external" });
    grid.toggleRowSelection("a");
    grid.setRows(rows, { datasetKey: "q1" });
    expect(grid.getSnapshot().selection.ranges).toHaveLength(1);
    expect(grid.getSnapshot().datasetKey).toBe("q1");
  });

  test("an unchanged key preserves selection, focus and edit", () => {
    const grid = externalGrid();
    grid.setRows(rows, { datasetKey: "q1" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
    expect(snap.editing).not.toBeNull();
    expect(snap.matchingTotal).toEqual({ kind: "exact", count: 3 });
  });

  test("a changed key clears selection, focus and edit", () => {
    const grid = externalGrid();
    grid.setRows(rows, { datasetKey: "q2" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.focus).toEqual({ rowId: null, columnId: null });
    expect(snap.editing).toBeNull();
    expect(snap.datasetKey).toBe("q2");
  });

  test("a changed key suppresses the clamped-index focus fallback", () => {
    // Focus is on "a" at index 0 and "a" is gone from the replacement, so the
    // clamped-index fallback is the only thing that could produce a focus.
    const replacement = [
      { id: "x", name: "Xu", score: 5 },
      { id: "y", name: "Yi", score: 6 },
    ];

    const sameKey = externalGrid();
    sameKey.setRows(replacement, { datasetKey: "q1" });
    expect(sameKey.getSnapshot().focus).toEqual({
      rowId: "x",
      columnId: "name",
    });

    const pivoted = externalGrid();
    pivoted.setRows(replacement, { datasetKey: "q2" });
    expect(pivoted.getSnapshot().focus).toEqual({
      rowId: null,
      columnId: null,
    });
  });

  test("a changed key clears group-expansion overrides", () => {
    const grid = makeGrid({ filter: "external" });
    grid.setRows(rows, { datasetKey: "q1" });
    grid.setRowGroups(["score"]);
    const firstGroup = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "group")!;
    grid.setGroupExpanded(firstGroup.id, false);
    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(1);
    grid.setRows(rows, { datasetKey: "q2" });
    expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(0);
  });

  test("setResultMeta can pivot the dataset too", () => {
    const grid = externalGrid();
    grid.setResultMeta({ datasetKey: "q2" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.datasetKey).toBe("q2");
  });

  test("a changed key drops the previous query's matchingTotal", () => {
    const grid = externalGrid();
    grid.setRows([rows[0]!], { datasetKey: "q2" });
    expect(grid.getSnapshot().matchingTotal).toEqual({ kind: "unknown" });
  });

  test("setResultMeta drops the previous query's matchingTotal too", () => {
    const grid = externalGrid();
    grid.setResultMeta({ datasetKey: "q2" });
    expect(grid.getSnapshot().matchingTotal).toEqual({ kind: "unknown" });
  });

  test("a total supplied with the changed key survives the clear", () => {
    const grid = externalGrid();
    grid.setRows(rows, {
      datasetKey: "q2",
      total: { kind: "exact", count: 9 },
    });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "exact",
      count: 9,
    });
    grid.setResultMeta({
      datasetKey: "q3",
      total: { kind: "unknown", atLeast: 40 },
    });
    expect(grid.getSnapshot().matchingTotal).toEqual({
      kind: "unknown",
      atLeast: 40,
    });
  });

  test("a changed key clears interaction state under engine authority", () => {
    const grid = makeGrid();
    grid.setRows(rows, { datasetKey: "q1" });
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.setRows(rows, { datasetKey: "q2" });
    const snap = grid.getSnapshot();
    expect(snap.selection.ranges).toEqual([]);
    expect(snap.focus).toEqual({ rowId: null, columnId: null });
  });

  test("a non-string key is neither an assignment nor a pivot", () => {
    const grid = externalGrid();
    grid.setRows(rows, {
      datasetKey: null,
    } as unknown as PretableResultMeta);
    expect(grid.getSnapshot().datasetKey).toBe("q1");

    grid.toggleRowSelection("a");
    grid.setRows(rows, { datasetKey: "q2" });
    expect(grid.getSnapshot().selection.ranges).toEqual([]);
  });
});

describe("setResultMeta with a non-string datasetKey", () => {
  // TypeScript rejects this; an untyped JS consumer passing a numeric query id
  // does not. `isDatasetPivot` already requires a string, so without the same
  // guard on the assignment the key lands in a `string | null` slot and the
  // pivot is consumed without clearing.
  test("leaves the key and the interaction state alone", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRows(rows, { datasetKey: "q1" });
    grid.toggleRowSelection("a");

    grid.setResultMeta({ datasetKey: 7 as unknown as string });

    const snap = grid.getSnapshot();
    expect(snap.datasetKey).toBe("q1");
    expect(snap.selection.ranges).toHaveLength(1);
  });
});
