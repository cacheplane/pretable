import { describe, expect, it } from "vitest";
import { buildFilters, SECTORS } from "../filters";

describe("buildFilters", () => {
  it("is empty for the default state", () => {
    expect(buildFilters({ search: "", sector: null })).toEqual({});
  });
  it("maps search to the symbol column", () => {
    expect(buildFilters({ search: "nvda", sector: null })).toEqual({ symbol: "nvda" });
  });
  it("maps a sector chip to the sector column", () => {
    expect(buildFilters({ search: "", sector: "Energy" })).toEqual({ sector: "Energy" });
  });
  it("composes both (AND)", () => {
    expect(buildFilters({ search: "x", sector: "Technology" })).toEqual({ symbol: "x", sector: "Technology" });
  });
  it("trims whitespace-only search to empty", () => {
    expect(buildFilters({ search: "   ", sector: null })).toEqual({});
  });
  it("exposes the sector list including All", () => {
    expect(SECTORS[0]).toBe("All");
    expect(SECTORS).toContain("Technology");
  });
});
