import { describe, expect, it } from "vitest";
import { LAYOUT_ROWS, makeLayoutColumns } from "../showcase/columnLayoutData";

describe("columnLayoutData", () => {
  it("has a dozen rows with unique ids", () => {
    expect(LAYOUT_ROWS).toHaveLength(12);
    expect(new Set(LAYOUT_ROWS.map((r) => r.id)).size).toBe(12);
  });

  it("defines eight columns in the expected order", () => {
    const ids = makeLayoutColumns().map((c) => c.id);
    expect(ids).toEqual([
      "symbol",
      "sector",
      "qty",
      "last",
      "mktValue",
      "dayPnl",
      "weight",
      "note",
    ]);
  });
});
