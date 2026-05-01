import { afterEach, describe, expect, test } from "vitest";

import { getDensityHeights } from "../density";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
});

describe("getDensityHeights", () => {
  test("returns fallback values when no CSS variables are set", () => {
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32);
    expect(heights.headerHeight).toBe(36);
  });

  test("reads numeric pixel values from --pretable-row-height and --pretable-header-height", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "48px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "52px",
    );
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(48);
    expect(heights.headerHeight).toBe(52);
  });

  test("falls back when only one variable is set", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "22px");
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(22);
    expect(heights.headerHeight).toBe(36); // fallback
  });

  test("falls back when value is not a px-suffixed number", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "auto");
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32); // fallback when value can't be parsed
  });

  test("parses fractional pixel values", () => {
    document.documentElement.style.setProperty(
      "--pretable-row-height",
      "23.5px",
    );
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(23.5);
  });
});
