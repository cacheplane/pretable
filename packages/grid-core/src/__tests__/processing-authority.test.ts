import { describe, expect, test } from "vitest";

import {
  createGridCore,
  type PretableProcessingAuthority,
  type PretableProcessingOptions,
} from "../index";
import type { PretableDataRow, PretableGroupRow } from "../types";

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

function makeGrid(processing?: PretableProcessingOptions) {
  return createGridCore<Row>({
    columns: columns.map((c) => ({ ...c })),
    rows: rows.map((r) => ({ ...r })),
    getRowId: (row: Row) => row.id,
    processing,
  });
}

function dataIds(grid: ReturnType<typeof makeGrid>): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((e): e is PretableDataRow<Row> => e.kind === "data")
    .map((e) => e.id);
}

describe("processing authority", () => {
  test("accepts a processing option without changing the default model", () => {
    const engine: PretableProcessingAuthority = "engine";
    expect(dataIds(makeGrid({ filter: engine, sort: engine }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  test("engine/engine is today's behavior byte-for-byte", () => {
    const grid = makeGrid();
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["b"]);
  });

  test("external/external leaves the supplied order untouched", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["a", "b", "c"]);
  });

  test("external filter with engine sort sorts the unfiltered records", () => {
    const grid = makeGrid({ filter: "external", sort: "engine" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(dataIds(grid)).toEqual(["b", "c", "a"]);
  });

  test("engine filter with external sort filters but keeps supplied order", () => {
    const grid = makeGrid({ filter: "engine", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("score", { operator: "gte", value: 2 });
    expect(dataIds(grid)).toEqual(["a", "c"]);
  });

  test("mutators still record display state under external authority", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setSort("score", "asc");
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    const snap = grid.getSnapshot();
    expect(snap.sort).toEqual([{ columnId: "score", direction: "asc" }]);
    expect(snap.filters).toEqual({
      name: { operator: "contains", value: "b" },
    });
  });

  test("sortable:false still prunes under external sort authority", () => {
    const grid = createGridCore<Row>({
      columns: [{ id: "name" }, { id: "score", sortable: false }],
      rows: rows.map((r) => ({ ...r })),
      getRowId: (row: Row) => row.id,
      processing: { filter: "external", sort: "external" },
    });
    grid.setSort("score", "asc");
    expect(grid.getSnapshot().sort).toEqual([]);
  });

  test("grouping still works under external authority", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRowGroups(["score"]);
    expect(
      grid.getSnapshot().visibleRows.filter((r) => r.kind === "group"),
    ).toHaveLength(3);
  });

  // The fixture is supplied in score order 3, 1, 2 — so an assertion of 1, 2, 3
  // separates "engine orders group headers by key" from "the supplied order is
  // preserved". External sort authority governs the record order the engine
  // folds over, not the group structure it synthesizes on top.
  test("group headers stay in engine key order under external sort authority", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    grid.setRowGroups(["score"]);
    expect(
      grid
        .getSnapshot()
        .visibleRows.filter((r): r is PretableGroupRow => r.kind === "group")
        .map((r) => r.value),
    ).toEqual([1, 2, 3]);
  });

  test("a sort change under external authority reuses the derived rows", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    const before = grid.getSnapshot().visibleRows;
    grid.setSort("score", "asc");
    expect(grid.getSnapshot().visibleRows).toBe(before);
  });

  test("a filter change under external authority reuses the derived rows", () => {
    const grid = makeGrid({ filter: "external", sort: "external" });
    const before = grid.getSnapshot().visibleRows;
    grid.setColumnFilter("name", { operator: "contains", value: "b" });
    expect(grid.getSnapshot().visibleRows).toBe(before);
  });

  test("a sort change under engine authority still re-derives", () => {
    const grid = makeGrid();
    const before = grid.getSnapshot().visibleRows;
    grid.setSort("score", "asc");
    expect(grid.getSnapshot().visibleRows).not.toBe(before);
  });
});
