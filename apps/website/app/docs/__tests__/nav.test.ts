import { describe, expect, it } from "vitest";

import { docsNav } from "../_nav";

describe("documentation navigation", () => {
  it("places Grouping directly after Filtering", () => {
    const grid = docsNav.find((section) => section.title === "Grid");
    expect(grid).toBeDefined();

    const filtering = grid!.items.findIndex(
      (item) => item.href === "/docs/grid/filtering",
    );
    expect(filtering).toBeGreaterThanOrEqual(0);
    expect(grid!.items[filtering + 1]).toEqual({
      title: "Grouping",
      href: "/docs/grid/grouping",
    });
  });
});
