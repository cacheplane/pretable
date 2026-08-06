import { describe, expect, it } from "vitest";
import { LAYOUT_ROWS, makeLayoutColumns } from "../showcase/columnLayoutData";

describe("columnLayoutData", () => {
  it("has a dozen rows with unique ids", () => {
    expect(LAYOUT_ROWS).toHaveLength(12);
    expect(new Set(LAYOUT_ROWS.map((r) => r.id)).size).toBe(12);
  });

  it("defines nine columns in the expected order", () => {
    const ids = makeLayoutColumns().map((c) => c.id);
    expect(ids).toEqual([
      "symbol",
      "name",
      "sector",
      "qty",
      "last",
      "mktValue",
      "dayPnl",
      "weight",
      "note",
    ]);
  });

  it("pins the analyst note column to the right", () => {
    const columns = makeLayoutColumns();
    const note = columns.find((c) => c.id === "note");
    expect(note?.pinned).toBe("right");
    // Exactly one pinned column keeps the showcase legible.
    expect(columns.filter((c) => c.pinned !== undefined)).toHaveLength(1);
  });

  it("is wider than the showcase container so the grid scrolls horizontally", () => {
    const total = makeLayoutColumns().reduce(
      (sum, c) => sum + (c.widthPx ?? 0),
      0,
    );
    // The showcase content column is capped at 1240px (max-w-[1240px]).
    expect(total).toBeGreaterThan(1240);
  });
});
