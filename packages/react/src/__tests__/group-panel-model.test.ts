import { describe, expect, it } from "vitest";

import {
  composeChipAccessibleName,
  insertGroupLevel,
  moveGroupLevel,
  removeGroupLevel,
} from "../group-panel/group-panel-model";

const levels = ["sector", "industry", "country"] as const;

describe("moveGroupLevel", () => {
  it("moves a level forward", () => {
    expect(moveGroupLevel(levels, 0, 2)).toEqual([
      "industry",
      "country",
      "sector",
    ]);
  });

  it("moves a level backward", () => {
    expect(moveGroupLevel(levels, 2, 0)).toEqual([
      "country",
      "sector",
      "industry",
    ]);
  });

  it("is a no-op when the indices match", () => {
    expect(moveGroupLevel(levels, 1, 1)).toBe(levels);
  });

  it("is a no-op — not a wrap or a clamp — when either index is out of range", () => {
    // Shift+ArrowLeft on the first chip asks for -1; it must stay put rather
    // than jump to the end.
    expect(moveGroupLevel(levels, 0, -1)).toBe(levels);
    expect(moveGroupLevel(levels, 2, 3)).toBe(levels);
    expect(moveGroupLevel(levels, 9, 0)).toBe(levels);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b"];
    moveGroupLevel(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("removeGroupLevel", () => {
  it("drops the level at the index", () => {
    expect(removeGroupLevel(levels, 1)).toEqual(["sector", "country"]);
  });

  it("empties a single-level list", () => {
    expect(removeGroupLevel(["sector"], 0)).toEqual([]);
  });

  it("is a no-op when the index is out of range", () => {
    expect(removeGroupLevel(levels, 3)).toBe(levels);
    expect(removeGroupLevel(levels, -1)).toBe(levels);
  });
});

describe("insertGroupLevel", () => {
  it("inserts at the index", () => {
    expect(insertGroupLevel(levels, "size", 1)).toEqual([
      "sector",
      "size",
      "industry",
      "country",
    ]);
  });

  it("clamps rather than refuses, because the index is a drop position", () => {
    expect(insertGroupLevel(levels, "size", 99)).toEqual([...levels, "size"]);
    expect(insertGroupLevel(levels, "size", -4)).toEqual(["size", ...levels]);
  });

  it("moves a column that is already grouped instead of duplicating it", () => {
    expect(insertGroupLevel(levels, "country", 0)).toEqual([
      "country",
      "sector",
      "industry",
    ]);
  });

  it("is a no-op when the column is already at that index", () => {
    expect(insertGroupLevel(levels, "industry", 1)).toBe(levels);
  });
});

describe("composeChipAccessibleName", () => {
  it("carries the column, its position, and the keys — the visible text has none of that", () => {
    const name = composeChipAccessibleName("Sector", 1, 2);

    expect(name).toContain("Sector");
    expect(name).toContain("1 of 2");
    expect(name).toContain("Delete");
  });
});
