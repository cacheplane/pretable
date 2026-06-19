import { describe, expect, it } from "vitest";
import { buildFilters, SECTORS } from "../filters";

describe("buildFilters", () => {
  it("is empty for the default state", () => {
    expect(buildFilters({ search: "", sector: null })).toEqual({});
  });
  it("maps search to a contains filter on the symbol column", () => {
    expect(buildFilters({ search: "nvda", sector: null })).toEqual({
      symbol: { operator: "contains", value: "nvda" },
    });
  });
  it("maps a sector chip to an isAnyOf filter on the sector column", () => {
    expect(buildFilters({ search: "", sector: "Energy" })).toEqual({
      sector: { operator: "isAnyOf", value: ["Energy"] },
    });
  });
  it("composes both (AND)", () => {
    expect(buildFilters({ search: "x", sector: "Technology" })).toEqual({
      symbol: { operator: "contains", value: "x" },
      sector: { operator: "isAnyOf", value: ["Technology"] },
    });
  });
  it("trims whitespace-only search to empty", () => {
    expect(buildFilters({ search: "   ", sector: null })).toEqual({});
  });
  it("exposes the sector list including All", () => {
    expect(SECTORS[0]).toBe("All");
    expect(SECTORS).toContain("Technology");
  });
});
