import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  getGridRowBoxMetrics,
  getThemeBoxMetrics,
  resetRowBoxMetricsCacheForTesting,
  useResolvedHeights,
  useResolvedPx,
} from "../density";
import { getDensityHeights } from "@pretable/ui";

afterEach(() => {
  resetRowBoxMetricsCacheForTesting();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
  document.body.replaceChildren();
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

describe("getThemeBoxMetrics", () => {
  function cellWith(lineHeight: string): HTMLElement {
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.style.lineHeight = lineHeight;
    document.body.append(cell);
    return cell;
  }

  test("resolves every field from the theme", () => {
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-x",
      "16px",
    );
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-y",
      "12px",
    );
    document.documentElement.style.setProperty("--pretable-rule-width", "2px");

    expect(getThemeBoxMetrics(cellWith("21px"))).toEqual({
      lineHeightPx: 21,
      paddingXPx: 16,
      paddingYPx: 12,
      borderPx: 2,
    });
  });

  test("finds a cell in the document when none is passed", () => {
    cellWith("18px");
    expect(getThemeBoxMetrics().lineHeightPx).toBe(18);
  });

  // The safety property for the whole phase: with no theme and nothing
  // rendered, the box must reproduce today's estimator constants exactly, so
  // an unthemed grid's estimates do not move.
  test("falls back to today's effective values when there is no theme", () => {
    const box = getThemeBoxMetrics(null);

    // `ROW_LINE_HEIGHT` in create-renderer.ts.
    expect(box.lineHeightPx).toBe(24);
    // Today the estimator wraps at the full column width.
    expect(box.paddingXPx).toBe(0);
    // `ROW_CHROME_HEIGHT` in create-renderer.ts, which is what Task 2 computes
    // as `2 × paddingY + border`.
    expect(box.paddingYPx * 2 + box.borderPx).toBe(42);
    expect(box.borderPx).toBe(1);
  });

  test("falls back per field, so a partial theme does not drag the rest", () => {
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-x",
      "6px",
    );

    const box = getThemeBoxMetrics(null);
    expect(box.paddingXPx).toBe(6);
    expect(box.paddingYPx * 2 + box.borderPx).toBe(42);
    expect(box.lineHeightPx).toBe(24);
  });

  test("falls back rather than yielding NaN for non-px token values", () => {
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-x",
      "1rem",
    );
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-y",
      "auto",
    );
    document.documentElement.style.setProperty("--pretable-rule-width", "thin");

    const box = getThemeBoxMetrics(null);
    expect(box.paddingXPx).toBe(0);
    expect(box.paddingYPx * 2 + box.borderPx).toBe(42);
    for (const value of Object.values(box)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("falls back rather than yielding NaN for a non-px line height", () => {
    // `normal` is what an unstyled cell computes to outside a browser that
    // resolves the ratio, and a unitless ratio is legal CSS. Neither parses.
    expect(getThemeBoxMetrics(cellWith("normal")).lineHeightPx).toBe(24);
    expect(getThemeBoxMetrics(cellWith("1.5")).lineHeightPx).toBe(24);
    expect(getThemeBoxMetrics(cellWith("")).lineHeightPx).toBe(24);
  });

  test("returns the fallback box on the server, where there is no document", () => {
    vi.stubGlobal("document", undefined);
    const box = getThemeBoxMetrics();
    expect(box).toEqual({
      lineHeightPx: 24,
      paddingXPx: 0,
      paddingYPx: 20.5,
      borderPx: 1,
    });
  });
});

describe("getGridRowBoxMetrics", () => {
  function renderCell(lineHeight: string): HTMLElement {
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.style.lineHeight = lineHeight;
    document.body.append(cell);
    return cell;
  }

  test("reads the DOM once, not once per estimate", () => {
    // The controller calls this on EVERY row estimate. An earlier change in
    // this series put a document-wide querySelector plus a getComputedStyle on
    // that path and cost 679ms of a 1 187ms bench-app test under jsdom.
    renderCell("21px");
    const querySelector = vi.spyOn(document, "querySelector");
    const computedStyle = vi.spyOn(globalThis, "getComputedStyle");

    getGridRowBoxMetrics();
    getGridRowBoxMetrics();
    getGridRowBoxMetrics();

    expect(querySelector).toHaveBeenCalledTimes(1);
    expect(computedStyle.mock.calls.length).toBeGreaterThan(0);
    const readsAfterFirst = computedStyle.mock.calls.length;
    getGridRowBoxMetrics();
    expect(computedStyle).toHaveBeenCalledTimes(readsAfterFirst);
  });

  test("returns one object, because the estimate memo compares it by identity", () => {
    renderCell("21px");
    expect(getGridRowBoxMetrics()).toBe(getGridRowBoxMetrics());
  });

  test("returns null before a cell renders, and does not cache that", () => {
    // Null keeps the estimator on today's constants. Caching it would strand
    // the grid there for the rest of the session.
    expect(getGridRowBoxMetrics()).toBeNull();

    renderCell("21px");
    expect(getGridRowBoxMetrics()?.lineHeightPx).toBe(21);
  });

  test("returns null on the server, where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(getGridRowBoxMetrics()).toBeNull();
  });
});

describe("useResolvedPx hook", () => {
  test("returns the fallback or active CSS pixel value", () => {
    const { result, unmount } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );
    expect(result.current).toBe(36);

    unmount();
    document.documentElement.style.setProperty(
      "--pretable-group-panel-height",
      "44px",
    );

    const { result: activeResult } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );
    expect(activeResult.current).toBe(44);
  });

  test("re-renders when a watched root attribute changes", async () => {
    document.documentElement.style.setProperty(
      "--pretable-group-panel-height",
      "36px",
    );
    const { result } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36),
    );
    expect(result.current).toBe(36);

    await act(async () => {
      document.documentElement.style.setProperty(
        "--pretable-group-panel-height",
        "44px",
      );
      document.documentElement.setAttribute("data-density", "spacious");
      await Promise.resolve();
    });

    expect(result.current).toBe(44);
  });

  test("disabled mode avoids style reads and DOM subscriptions", () => {
    const getComputedStyleSpy = vi.spyOn(globalThis, "getComputedStyle");
    const mutationObserverSpy = vi.spyOn(globalThis, "MutationObserver");

    const { result } = renderHook(() =>
      useResolvedPx("--pretable-group-panel-height", 36, false),
    );

    expect(result.current).toBe(36);
    expect(getComputedStyleSpy).not.toHaveBeenCalled();
    expect(mutationObserverSpy).not.toHaveBeenCalled();
  });
});
