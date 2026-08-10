import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow } from "../types";

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

function dataIds(grid: ReturnType<typeof makeGrid>): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((e): e is PretableDataRow<Row> => e.kind === "data")
    .map((e) => e.id);
}

describe("processing authority", () => {
  test("accepts a processing option without changing the default model", () => {
    expect(dataIds(makeGrid({ filter: "engine", sort: "engine" }))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
