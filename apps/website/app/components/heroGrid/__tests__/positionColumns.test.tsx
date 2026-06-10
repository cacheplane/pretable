import { describe, expect, it } from "vitest";
import { positionColumns } from "../positionColumns";

describe("positionColumns", () => {
  it("exposes the expected columns in order", () => {
    expect(positionColumns.map((c) => c.id)).toEqual([
      "symbol", "qty", "last", "mktValue", "dayPnl", "weight", "analyst",
    ]);
  });
  it("pins the symbol column left", () => {
    expect(positionColumns.find((c) => c.id === "symbol")?.pinned).toBe("left");
  });
  it("wraps only the analyst column", () => {
    expect(positionColumns.find((c) => c.id === "analyst")?.wrap).toBe(true);
    expect(positionColumns.find((c) => c.id === "last")?.wrap).toBeFalsy();
  });
  it("marks the analyst column non-sortable", () => {
    expect(positionColumns.find((c) => c.id === "analyst")?.sortable).toBe(false);
  });
});
