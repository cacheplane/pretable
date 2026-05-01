import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { getDensityHeights, useResolvedHeights } from "../density";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
});

describe("getDensityHeights snapshot", () => {
  test("returns fallback values when no CSS variables are set", () => {
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32);
    expect(heights.headerHeight).toBe(36);
  });

  test("reads numeric pixel values from the documented CSS variables", () => {
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
    expect(heights.headerHeight).toBe(36);
  });

  test("falls back when value is not parseable as <number>px", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "auto");
    expect(getDensityHeights().rowHeight).toBe(32);
  });
});

describe("useResolvedHeights hook", () => {
  test("returns prop values when both props are passed (props win)", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "10px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "20px",
    );
    const { result } = renderHook(() => useResolvedHeights(48, 56));
    expect(result.current.rowHeight).toBe(48);
    expect(result.current.headerHeight).toBe(56);
  });

  test("returns CSS values when no props are passed", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "22px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "26px",
    );
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(22);
    expect(result.current.headerHeight).toBe(26);
  });

  test("returns fallbacks when neither props nor CSS variables are set", () => {
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(32);
    expect(result.current.headerHeight).toBe(36);
  });

  test("re-renders when [data-density] attribute changes on <html>", async () => {
    document.documentElement.style.setProperty("--pretable-row-height", "32px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "36px",
    );
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(32);

    await act(async () => {
      document.documentElement.style.setProperty(
        "--pretable-row-height",
        "56px",
      );
      document.documentElement.setAttribute("data-density", "spacious");
      // MutationObserver fires asynchronously; flush microtasks
      await Promise.resolve();
    });

    expect(result.current.rowHeight).toBe(56);
  });

  test("partial prop override (only rowHeight passed)", () => {
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "44px",
    );
    const { result } = renderHook(() => useResolvedHeights(99));
    expect(result.current.rowHeight).toBe(99);
    expect(result.current.headerHeight).toBe(44);
  });
});
