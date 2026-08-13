import { describe, expect, it } from "vitest";

import { loadExample } from "../examples/load";

describe("loadExample", () => {
  it("resolves a real registered example with its declared files in order", async () => {
    const example = await loadExample("grouping-panel");

    expect(example.hasDemo).toBe(true);
    expect(example.files.map((f) => f.path)).toEqual([
      "GroupingPanelGrid.tsx",
      "columns.ts",
      "data.ts",
    ]);
    for (const file of example.files) {
      expect(file.source.length).toBeGreaterThan(0);
    }

    // Not just non-empty — genuinely the real file's content.
    const [grid] = example.files;
    expect(grid.source).toContain('ariaLabel="Positions grouped by desk"');
  });

  it("memoises: two calls with the same id share one promise", () => {
    const first = loadExample("grouping-panel");
    const second = loadExample("grouping-panel");
    expect(second).toBe(first);
  });

  it("never leaves focus-marker text in the loaded source", async () => {
    const example = await loadExample("grouping-panel");
    for (const file of example.files) {
      expect(file.source).not.toMatch(/\[!focus/);
    }
  });
});
