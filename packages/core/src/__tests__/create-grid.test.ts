import { describe, expect, it } from "vitest";

import { createGrid } from "../index";

describe("createGrid", () => {
  it("re-exports the grid-core contract through the public package", () => {
    const grid = createGrid({
      columns: [{ id: "name", header: "Name" }],
      rows: [
        { id: "a", name: "Zulu" },
        { id: "b", name: "Alpha" },
      ],
      getRowId: (row) => row.id,
    });

    expect(grid.kind).toBe("pretable-grid");
    expect(typeof grid.subscribe).toBe("function");
    expect(grid.getSnapshot().visibleRows.map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);

    grid.setSort("name", "asc");

    expect(grid.getSnapshot().visibleRows.map((row) => row.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
