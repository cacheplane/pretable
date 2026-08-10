import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow } from "../types";

/**
 * D1-GRID-04: a default-constructed grid — no `processing`, no `resultMeta`,
 * no `dataState` — must behave exactly as it did before server-authority
 * primitives existed. Every assertion here describes shipped 0.0.9 behavior
 * and is expected to survive the whole slice untouched.
 */

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

function makeGrid() {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
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
    expect(snap.selection.ranges).toHaveLength(1);
    expect(snap.focus).toEqual({ rowId: "a", columnId: "name" });
  });

  test("grouping synthesizes headers with post-filter child counts", () => {
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
});
