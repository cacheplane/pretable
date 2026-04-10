import { describe, expect, it } from "vitest";

import { createGrid } from "../index";

describe("createGrid", () => {
  it("returns a typed placeholder instance", () => {
    const grid = createGrid({ columns: [], rows: [] });

    expect(grid.kind).toBe("pretable-grid");
  });
});
