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

  it("pins symbol left and the analyst note column right", () => {
    const columns = makeLayoutColumns();
    expect(columns.find((c) => c.id === "symbol")?.pinned).toBe("left");
    expect(columns.find((c) => c.id === "note")?.pinned).toBe("right");
    // One pin per edge keeps the showcase legible — and gives the smoke suite
    // a left-pinned column whose header overlays it can measure at scrollLeft 0.
    expect(columns.filter((c) => c.pinned !== undefined)).toHaveLength(2);
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
