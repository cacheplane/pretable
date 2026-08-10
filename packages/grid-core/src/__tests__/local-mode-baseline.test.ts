import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow } from "../types";

/**
 * D1-GRID-04: a default-constructed grid — no `processing`, no `resultMeta`,
 * no `dataState` — must behave exactly as it does at @pretable/core 0.0.11,
 * for the whole slice.
 *
 * Only these edits to this file are sanctioned while the slice is in flight:
 *
 *  1. Task 3's mechanical `totalRowCount` → `loadedRowCount` rename (landed).
 *  2. Task 6 Step 10 adding `"matchingTotal"` and `"datasetKey"` to the
 *     documented key list below — those two additive keys only, no removals
 *     and no value changes.
 *  3. Purely additive new `test(...)` blocks.
 *
 * Anything else — changing an expected value, loosening an assertion, deleting
 * a case — means local mode moved under a consumer who supplied none of the
 * new props. That is the regression this file exists to catch: fix the source,
 * not this file.
 */

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "a", name: "Ada", score: 3 },
  { id: "b", name: "Bob", score: 1 },
  { id: "c", name: "Cy", score: 2 },
];

/**
 * `score` is declared `type: "number"` and the filter cases below rely on it:
 * filter evaluation dispatches on the declared column type, so a `gt` against
 * an undeclared (therefore `"text"`) column matches nothing. Sorting is a
 * separate path that dispatches on the runtime value type — this file pins no
 * comparator behavior beyond that.
 */
const columns = [
  { id: "name", header: "Name" },
  { id: "score", header: "Score", type: "number" as const },
];

function makeGrid(sourceRows: Row[] = rows) {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: sourceRows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
  });
}

function dataIds(grid: ReturnType<typeof makeGrid>): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter(
      (entry): entry is PretableDataRow<Row> => entry.kind === "data",
    )
    .map((entry) => entry.id);
}

describe("local mode baseline", () => {
  test("snapshot exposes exactly the documented keys", () => {
    expect(Object.keys(makeGrid().getSnapshot()).sort()).toEqual(
      [
        "editing",
        "filters",
        "focus",
        "groupExpansionOverrides",
        "groupsDefaultExpanded",
        "rowGroups",
        "selection",
        "sort",
        "loadedRowCount",
        "matchingTotal",
        "datasetKey",
        "viewport",
        "visibleRange",
        "visibleRows",
      ].sort(),
    );
  });

  test("supplied order is the model order until a sort is set", () => {
    expect(dataIds(makeGrid())).toEqual(["a", "b", "c"]);
  });

  test("the engine applies sort locally", () => {
    const grid = makeGrid();
    grid.setSort("score", "asc");
    expect(dataIds(grid)).toEqual(["b", "c", "a"]);
  });

  test("the engine applies filters locally", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "a" });
    expect(dataIds(grid)).toEqual(["a"]);
  });

  test("the engine evaluates numeric operators against a number column", () => {
    const grid = makeGrid();
    grid.setColumnFilter("score", { operator: "gt", value: 1 });
    expect(dataIds(grid)).toEqual(["a", "c"]);
  });

  test("loadedRowCount counts source rows, not post-filter rows", () => {
    const grid = makeGrid();
    grid.setColumnFilter("name", { operator: "contains", value: "a" });
    expect(grid.getSnapshot().loadedRowCount).toBe(3);
  });

  test("setRows preserves selection and focus for surviving ids", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("a");
    grid.setFocus({ rowId: "a", columnId: "name" });
    grid.setRows([
      { id: "a", name: "Ada 2", score: 3 },
      { id: "b", name: "Bob", score: 1 },
    ]);
    const snap = grid.getSnapshot();
    // Identity, not just arity: ranges are id-keyed, so a range remapped onto
    // the wrong row would still leave the count at 1.
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.selection.ranges[0]?.startRowId).toBe("a");
    expect(snap.selection.ranges[0]?.endRowId).toBe("a");
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
  });

  test("grouping synthesizes one header per distinct value", () => {
    const grid = makeGrid();
    grid.setRowGroups(["score"]);
    const groups = grid
      .getSnapshot()
      .visibleRows.filter((r) => r.kind === "group");
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === "group" && g.childCount === 1)).toBe(
      true,
    );
  });

  test("group headers are derived from post-filter rows", () => {
    // Two rows share score 1, so a group built before the filter would report
    // childCount 2 and a third header for the filtered-away score 2.
    const grid = makeGrid([
      { id: "a", name: "Ada", score: 1 },
      { id: "b", name: "Bob", score: 1 },
      { id: "c", name: "Cy", score: 2 },
    ]);
    grid.setColumnFilter("name", { operator: "contains", value: "bo" });
    grid.setRowGroups(["score"]);
    const groups = grid
      .getSnapshot()
      .visibleRows.filter((r) => r.kind === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ value: 1, childCount: 1 });
  });
});
