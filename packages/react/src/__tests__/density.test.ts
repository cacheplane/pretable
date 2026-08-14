import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import {
  getGridRenderAdvances,
  getGridRowBoxMetrics,
  getThemeBoxMetrics,
  resetRenderAdvancesCacheForTesting,
  resetRowBoxMetricsCacheForTesting,
  useResolvedHeights,
  useResolvedPx,
} from "../density";
import {
  getGridAverageCharWidth,
  getGridLetterSpacingPx,
  getGridSegmentMeasurer,
  resetTextMetricsCacheForTesting,
} from "../text-metrics";
import { getDensityHeights } from "@pretable/ui";

afterEach(() => {
  resetRowBoxMetricsCacheForTesting();
  resetRenderAdvancesCacheForTesting();
  vi.useRealTimers();
  resetTextMetricsCacheForTesting();
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

/**
 * The cell is not always the element laying out its own text. The hero renders
 * its wrapped column as `<cell><span class="analyst">…`, the cell is
 * `display: flex`, and Chromium reports 21px on the cell and **20.3px** on the
 * span — the span's line boxes, which are the ones the estimator is counting.
 * Probed against the running hero, not assumed.
 *
 * jsdom does not resolve `line-height: 1.45` to px, and drops a separate
 * `line-height` declaration when the `font` shorthand is present, so every
 * element here states its line height through the shorthand — the same spelling
 * the theme-invalidation suite below uses, and the same one a real cell gets it
 * from.
 */
describe("line height comes from the element that lays out the text", () => {
  function cell(font: string): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-pretable-cell", "");
    element.setAttribute("style", `font: ${font}`);
    document.body.append(element);
    return element;
  }

  function child(parent: Element, font: string, text?: string): HTMLElement {
    const span = document.createElement("span");
    span.setAttribute("style", `font: ${font}`);
    if (text !== undefined) span.textContent = text;
    parent.append(span);
    return span;
  }

  test("resolves an inner span's line height, not the cell's", () => {
    const outer = cell("14px/21px Inter");
    child(outer, "14px/20.3px Inter", "wrapped analyst copy");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(20.3);
  });

  test("still resolves the span when it also holds an inline badge", () => {
    // The hero's exact shape: text plus a trailing element, inside one span.
    // The span has an element child, so a rule that only descended into
    // childless elements would stop at the cell and read 21px.
    const outer = cell("14px/21px Inter");
    const span = child(outer, "14px/20.3px Inter", "wrapped analyst copy");
    child(span, "11px/16px Inter", "hold");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(20.3);
  });

  test("descends through a wrapper that delegates all of its text", () => {
    const outer = cell("14px/21px Inter");
    const wrapper = child(outer, "14px/21px Inter");
    child(wrapper, "14px/18px Inter", "wrapped analyst copy");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(18);
  });

  test("resolves the cell's own line height when it has no descendant", () => {
    const outer = cell("14px/21px Inter");
    outer.textContent = "plain cell text";

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(21);
  });

  test("stops at the cell when the cell holds text of its own", () => {
    // Text directly in the cell means the cell is forming line boxes; a
    // sibling element cannot claim them.
    const outer = cell("14px/21px Inter");
    outer.append(document.createTextNode("leading text"));
    child(outer, "14px/20.3px Inter", "and a span");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(21);
  });

  test("stops at the cell when several children could claim the line boxes", () => {
    // Two element children and no way to say which governs. Declining to guess
    // leaves exactly the answer this code gave before the descent existed.
    const outer = cell("14px/21px Inter");
    child(outer, "14px/20.3px Inter", "first");
    child(outer, "14px/18px Inter", "second");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(21);
  });

  test("whitespace between elements does not stop the descent", () => {
    // JSX and pretty-printed HTML both leave whitespace text nodes between
    // elements. Treating one as "the cell lays out text" would strand every
    // such cell on the cell's own line height.
    const outer = cell("14px/21px Inter");
    outer.append(document.createTextNode("\n  "));
    child(outer, "14px/20.3px Inter", "wrapped analyst copy");

    expect(getThemeBoxMetrics(outer).lineHeightPx).toBe(20.3);
  });
});

describe("which cell the row box is sampled from", () => {
  function appendCell(
    font: string,
    attributes: Record<string, string> = {},
  ): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-pretable-cell", "");
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.setAttribute("style", `font: ${font}`);
    element.textContent = "cell text";
    document.body.append(element);
    return element;
  }

  test("prefers a wrapped cell, because wrapped text is what this is applied to", () => {
    appendCell("14px/21px Inter");
    appendCell("14px/20.3px Inter", { "data-pretable-wrap": "true" });

    expect(getGridRowBoxMetrics()?.lineHeightPx).toBe(20.3);
  });

  test("skips the row-select cell, which is first in the DOM and 11px inside", () => {
    // The synthetic row-select column is left-pinned, so its cell is the FIRST
    // [data-pretable-cell] in the document and an unscoped querySelector lands
    // on it. It reports the cell font like any other cell — but its only child
    // is the checkbox button, which Chromium computes at 11px/11px on the hero.
    // Sampling it would report an 11px line height for the whole grid.
    const rowSelect = appendCell("14px/21px Inter", {
      "data-pretable-row-select-cell": "true",
    });
    rowSelect.textContent = "";
    const button = document.createElement("button");
    button.setAttribute("style", "font: 11px/11px Inter");
    rowSelect.append(button);

    appendCell("14px/21px Inter");

    expect(getGridRowBoxMetrics()?.lineHeightPx).toBe(21);
  });

  test("returns null when only the row-select cell has rendered", () => {
    // Nothing readable, so the estimator keeps its constants rather than
    // resolving half a box off the checkbox.
    appendCell("14px/21px Inter", { "data-pretable-row-select-cell": "true" });

    expect(getGridRowBoxMetrics()).toBeNull();
  });
});

/**
 * The estimator reads the raw cell value, so anything a `render` draws BESIDE
 * that text is invisible to it while still consuming width. On the homepage
 * hero that is a stance badge, and it is 55 per cent of the estimator's
 * remaining systematic under-estimate.
 *
 * What is measured, and what is declined, is stated on `measureRenderAdvance`
 * in `density.ts`. These tests are that statement, executable.
 */
describe("getGridRenderAdvances", () => {
  function wrappedCell(columnId = "analyst"): HTMLElement {
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.setAttribute("data-pretable-wrap", "true");
    cell.setAttribute("data-pretable-column-id", columnId);
    document.body.append(cell);
    return cell;
  }

  /**
   * An inline element with a known footprint. jsdom lays nothing out, so the
   * client rects are the part that has to be stated: `rects` is how many line
   * boxes the element occupies, which is exactly what the decline rule reads.
   */
  function inlineElement(
    parent: Element,
    options: { widthPx: number; marginLeftPx?: number; rects?: number },
  ): HTMLElement {
    const element = document.createElement("span");
    element.textContent = "hold";
    if (options.marginLeftPx !== undefined) {
      element.style.marginLeft = `${options.marginLeftPx}px`;
    }
    Object.defineProperty(element, "getClientRects", {
      value: () =>
        Array.from({ length: options.rects ?? 1 }, () => ({
          width: options.widthPx,
        })),
    });
    parent.append(element);
    return element;
  }

  test("measures a badge drawn beside the text, margin included", () => {
    // The hero's exact shape, and its exact numbers: Chromium reports a
    // 53.390625px badge with a 6px left margin on the running site, and the
    // 59.390625px total sits inside the (58.61, 64.82] px interval PR #370
    // derived from horizontal slack alone, without using any height data.
    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Up on hyperscaler capex headlines."));
    cell.append(span);
    inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });

    expect(getGridRenderAdvances()?.get("analyst")?.widthPx).toBe(59.390625);
  });

  test("sums a leading icon and a trailing badge", () => {
    // Both sides of the text reduce the space it has to run in; nothing about
    // this is specific to a trailing element.
    const cell = wrappedCell();
    const span = document.createElement("span");
    inlineElement(span, { widthPx: 16 });
    span.append(document.createTextNode("Defensive ballast still intact."));
    inlineElement(span, { widthPx: 40, marginLeftPx: 6 });
    cell.append(span);

    expect(getGridRenderAdvances()?.get("analyst")?.widthPx).toBe(62);
  });

  test("declines when the text is itself inside an element", () => {
    // `<b>text</b><chip/>`: which child is the prose the estimator wraps and
    // which is the ornament beside it is not decidable from the DOM. Yielding
    // nothing keeps today's behaviour; guessing is what this series has spent
    // seven PRs unwinding.
    const cell = wrappedCell();
    const span = document.createElement("span");
    const bold = document.createElement("b");
    bold.textContent = "Defensive ballast still intact.";
    // Given a measurable footprint of its own, so that the ONLY thing that can
    // decline this shape is the "no direct text" rule under test. Without it
    // jsdom's empty client-rect list declines the bold element instead and the
    // test passes for the wrong reason — which it did, until a mutation of the
    // direct-text rule failed to break it.
    Object.defineProperty(bold, "getClientRects", {
      value: () => [{ width: 180 }],
    });
    span.append(bold);
    inlineElement(span, { widthPx: 53, marginLeftPx: 6 });
    cell.append(span);

    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);
  });

  test("declines when a child wraps across line boxes of its own", () => {
    // Two client rects means the child is flow content participating in the
    // wrap, not a fixed advance beside it. Its footprint is not one number.
    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Defensive ballast still intact."));
    inlineElement(span, { widthPx: 200, rects: 2 });
    cell.append(span);

    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);
  });

  test("declines a child that is not laid out at all", () => {
    // Zero rects: `display: none`, or a host that reports no geometry. There
    // is nothing to charge.
    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Defensive ballast still intact."));
    inlineElement(span, { widthPx: 53, rects: 0 });
    cell.append(span);

    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);
  });

  test("a column that draws nothing beside its text gets no entry", () => {
    // The overwhelmingly common case, and it must cost the estimator nothing.
    const cell = wrappedCell();
    cell.textContent = "plain wrapped prose";

    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);
  });

  test("an empty cell is not a decline: the advance arrives with the content", () => {
    // The hero's rows start with `analyst: ""`, so at first paint the wrapped
    // column has no text and no badge. Recording "no advance" then would make
    // this fix inert on the very grid it was diagnosed against — while a
    // fixture-fed instrument reported it working.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cell = wrappedCell();

    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);

    const span = document.createElement("span");
    span.append(document.createTextNode("Up on hyperscaler capex headlines."));
    cell.append(span);
    inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });

    // Rate limited: the retry is bounded, because `getClientRects` forces
    // layout and this is called on every estimate.
    vi.setSystemTime(1_100);
    expect(getGridRenderAdvances()?.has("analyst")).toBe(false);

    vi.setSystemTime(1_400);
    expect(getGridRenderAdvances()?.get("analyst")?.widthPx).toBe(59.390625);
  });

  test("an attempt made before the first paint does not settle anything", () => {
    // The controller estimates rows before any cell exists, so the first
    // attempt sees an empty document. Counting "no wrapped columns" as "all of
    // them settled" would declare the resolution complete right there and
    // freeze every grid on "no advance" for the session.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    expect(getGridRenderAdvances()?.size).toBe(0);

    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Up on hyperscaler capex headlines."));
    cell.append(span);
    inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });

    vi.setSystemTime(1_400);
    expect(getGridRenderAdvances()?.get("analyst")?.widthPx).toBe(59.390625);
  });

  test("stops reading the DOM once every wrapped column has settled", () => {
    // The performance property. An earlier change in this series put a DOM read
    // on the estimate path and cost 679ms of a 1 187ms bench-app test under
    // jsdom; this read is worse than that one, because `getClientRects` forces
    // layout rather than only style.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Up on hyperscaler capex headlines."));
    cell.append(span);
    inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });

    getGridRenderAdvances();
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    const computedStyle = vi.spyOn(globalThis, "getComputedStyle");

    // The clock is stepped well past the retry interval on every call, so what
    // is being asserted is the settled short-circuit and not the rate limit.
    // Without this the test passed with the short-circuit deleted.
    for (let call = 0; call < 25; call += 1) {
      vi.setSystemTime(10_000 + call * 1_000);
      getGridRenderAdvances();
    }

    expect(querySelectorAll).not.toHaveBeenCalled();
    expect(computedStyle).not.toHaveBeenCalled();
  });

  test("returns one map, because the estimate memo compares it by identity", () => {
    // Including across a rate-limited retry that lands on the same numbers: a
    // fresh map every 250ms would throw away every memoized estimate four
    // times a second.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cell = wrappedCell();
    const span = document.createElement("span");
    span.append(document.createTextNode("Up on hyperscaler capex headlines."));
    cell.append(span);
    inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });
    // A second wrapped column with nothing in it yet, so the resolution never
    // settles and the retry keeps running.
    wrappedCell("notes");

    const first = getGridRenderAdvances();
    vi.setSystemTime(2_000);

    expect(getGridRenderAdvances()).toBe(first);
  });

  test("never samples the row-select cell", () => {
    // Its cell is the FIRST [data-pretable-cell] in the document — synthetic
    // and left-pinned — and its only child is the checkbox button. An unscoped
    // lookup lands on it; this one is scoped to wrapped cells, and the checkbox
    // is not one.
    const rowSelect = document.createElement("div");
    rowSelect.setAttribute("data-pretable-cell", "");
    rowSelect.setAttribute("data-pretable-row-select-cell", "true");
    rowSelect.setAttribute("data-pretable-column-id", "__pretable_row_select");
    rowSelect.append(document.createTextNode("x"));
    inlineElement(rowSelect, { widthPx: 11 });
    document.body.append(rowSelect);

    expect(getGridRenderAdvances()?.has("__pretable_row_select")).toBe(false);
  });

  test("returns null on the server, where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(getGridRenderAdvances()).toBeNull();
  });

  /**
   * The second term: how TALL the line box the render's output sits on is.
   *
   * jsdom lays nothing out, so every geometry these tests depend on is stated
   * explicitly — which is the point, because the rule is arithmetic over
   * geometry and the arithmetic is what can be wrong. The numbers are the
   * hero's real ones (Chromium, `span.analyst` at 14px/20.3px with the stance
   * badge), so a passing test reproduces the measured 22.61875px rather than a
   * made-up one. See `measureLastLineBox` in `density.ts` for the probe.
   */
  describe("the last line box", () => {
    /**
     * A cell laid out like the hero's: `<cell><span>text<badge/></span></cell>`,
     * with the span's box height and the line rects its text occupies stated.
     *
     * `lineRects` is one entry per line box of the TEXT; the badge contributes
     * its own rect, overlapping the last of them when it shares that line and
     * sitting below them when it was pushed onto a line of its own. Both shapes
     * occur in the hero and both must count the same number of line boxes.
     */
    function heroCell(options: {
      spanHeightPx: number;
      lineHeightPx?: number;
      lineTops: readonly number[];
      badge?: { topPx: number; heightPx: number; widthPx?: number } | null;
    }): HTMLElement {
      const cell = wrappedCell();
      const span = document.createElement("span");
      span.style.lineHeight = `${options.lineHeightPx ?? 20.3}px`;
      span.append(
        document.createTextNode("Up on hyperscaler capex headlines."),
      );
      Object.defineProperty(span, "getBoundingClientRect", {
        value: () => ({ height: options.spanHeightPx, top: 0 }),
        configurable: true,
      });
      cell.append(span);

      if (options.badge !== null) {
        const badge = options.badge ?? { topPx: 40.59375, heightPx: 21.25 };
        const rect = {
          top: badge.topPx,
          bottom: badge.topPx + badge.heightPx,
          width: badge.widthPx ?? 53.390625,
          height: badge.heightPx,
        };
        const element = document.createElement("span");
        element.style.marginLeft = "6px";
        Object.defineProperty(element, "getClientRects", {
          value: () => [rect],
        });
        Object.defineProperty(element, "getBoundingClientRect", {
          value: () => rect,
        });
        span.append(element);
      }

      // The text's line boxes. `Range.getClientRects` is what reports them in a
      // browser and reports nothing in jsdom, so it is stated here.
      vi.spyOn(document, "createRange").mockImplementation(
        () =>
          ({
            selectNodeContents: () => {},
            getClientRects: () =>
              options.lineTops.map((top) => ({ top, bottom: top + 17 })),
          }) as unknown as Range,
      );
      return cell;
    }

    test("measures the line box the browser built, not the badge's own height", () => {
      // The hero's numbers exactly. `max(lineHeight, badgeHeight)` — the model
      // this task set out to implement — is 21.25px; the browser produced
      // 22.61875px, because a baseline-aligned inline contributes its ascent
      // and its descent separately and each is maxed against the strut's.
      heroCell({
        spanHeightPx: 63.21875,
        lineTops: [0, 20.296875, 40.59375],
        badge: { topPx: 41.96875, heightPx: 21.25 },
      });

      expect(getGridRenderAdvances()?.get("analyst")?.lastLineBoxPx).toBe(
        22.61875,
      );
    });

    test("counts a badge pushed onto a line of its own as another line", () => {
      // The other hero shape: two text lines, badge below them, three line
      // boxes. The leftover has to come out the same, and in Chromium it did —
      // 22.61875 on both. Counting only the text's lines would report
      // 42.91875px here and charge every such row 20px it does not need.
      heroCell({
        spanHeightPx: 63.21875,
        lineTops: [0, 20.296875],
        badge: { topPx: 41.96875, heightPx: 21.25 },
      });

      expect(getGridRenderAdvances()?.get("analyst")?.lastLineBoxPx).toBe(
        22.61875,
      );
    });

    test("a plain line is reported at the line height, not above it", () => {
      // The control, and the reason the estimator can clamp: with nothing tall
      // on the last line the leftover IS the line height (a hair under it, in a
      // browser, because the per-line advance is quantised). Charging a plain
      // column for this is the failure mode the clamp exists to prevent.
      heroCell({
        spanHeightPx: 60.890625,
        lineTops: [0, 20.296875, 40.59375],
        badge: { topPx: 40.59375, heightPx: 17 },
      });

      const measured = getGridRenderAdvances()?.get("analyst")?.lastLineBoxPx;
      expect(measured).toBeCloseTo(20.29, 2);
      expect(measured).toBeLessThanOrEqual(20.3);
    });

    test("declines a leftover larger than any inline on the line could explain", () => {
      // The bound, and it is the whole safety property of an inferred number.
      // An element whose height is NOT the sum of its own line boxes — a grid,
      // a float, an absolutely positioned child, an inset this cannot read —
      // leaves a leftover with no inline behind it. 200px against a bound of
      // 20.3 + 21.25 is rejected rather than charged to every row.
      heroCell({
        spanHeightPx: 240.89,
        lineTops: [0, 20.296875, 40.59375],
        badge: { topPx: 41.96875, heightPx: 21.25 },
      });

      expect(getGridRenderAdvances()?.get("analyst")?.lastLineBoxPx).toBeNull();
    });

    test("declines when the line height is not readable", () => {
      // Without the line height there is nothing to subtract the earlier lines
      // at, so the leftover is not computable. `normal` — no theme states a
      // cell line-height — lands here.
      heroCell({
        spanHeightPx: 63.21875,
        lineTops: [0, 20.296875, 40.59375],
        badge: { topPx: 41.96875, heightPx: 21.25 },
      }).querySelector("span")!.style.lineHeight = "normal";

      expect(getGridRenderAdvances()?.get("analyst")?.lastLineBoxPx).toBeNull();
    });

    test("declines where nothing is laid out at all", () => {
      // jsdom, and a browser before first paint: a zero box is not a
      // measurement. Every other test in this file runs through this path,
      // which is why they all report `null` for this term.
      const cell = wrappedCell();
      const span = document.createElement("span");
      span.style.lineHeight = "20.3px";
      span.append(
        document.createTextNode("Up on hyperscaler capex headlines."),
      );
      inlineElement(span, { widthPx: 53.390625, marginLeftPx: 6 });
      cell.append(span);

      expect(getGridRenderAdvances()?.get("analyst")).toEqual({
        widthPx: 59.390625,
        lastLineBoxPx: null,
      });
    });

    test("a shape that declines to yield a width yields no height either", () => {
      // One gate for both terms. `<b>text</b><chip/>` cannot be attributed —
      // which child is the prose and which the ornament is not decidable — so
      // it gets no entry at all, not an entry with a line box in it.
      const cell = wrappedCell();
      const span = document.createElement("span");
      span.style.lineHeight = "20.3px";
      const bold = document.createElement("b");
      bold.textContent = "Defensive ballast still intact.";
      Object.defineProperty(bold, "getClientRects", {
        value: () => [{ width: 180, top: 0, bottom: 17 }],
      });
      span.append(bold);
      Object.defineProperty(span, "getBoundingClientRect", {
        value: () => ({ height: 63.21875, top: 0 }),
      });
      inlineElement(span, { widthPx: 53, marginLeftPx: 6 });
      cell.append(span);

      expect(getGridRenderAdvances()?.has("analyst")).toBe(false);
    });

    test("a line box that moves publishes a new map, or the memo never re-runs", () => {
      // The estimate memo keys on this map's IDENTITY. The width alone deciding
      // that identity would freeze every row at the height computed before the
      // line box was measured — the exact arrival-order bug this series has
      // now hit for the box, the width, the measurer and the advance.
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      // A second wrapped column with nothing in it, so the resolution never
      // settles and the rate-limited retry keeps looking.
      wrappedCell("notes");
      const cell = heroCell({
        spanHeightPx: 63.21875,
        lineTops: [0, 20.296875, 40.59375],
        badge: { topPx: 41.96875, heightPx: 21.25 },
      });

      const first = getGridRenderAdvances();
      expect(first?.get("analyst")?.lastLineBoxPx).toBe(22.61875);

      // Same width, taller line box: the badge grew (a density swap, a font
      // change). Nothing about the width moved.
      const span = cell.querySelector("span")!;
      Object.defineProperty(span, "getBoundingClientRect", {
        value: () => ({ height: 68.21875, top: 0 }),
        configurable: true,
      });
      vi.setSystemTime(2_000);

      const second = getGridRenderAdvances();
      expect(second).not.toBe(first);
      expect(second?.get("analyst")?.lastLineBoxPx).toBe(27.61875);
      expect(second?.get("analyst")?.widthPx).toBe(
        first?.get("analyst")?.widthPx,
      );
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

    // The resolution is a bounded, one-off sweep: the wrapped-cell preference
    // and its non-row-select fallback, and nothing per cell or per descendant.
    expect(querySelector.mock.calls.length).toBeGreaterThan(0);
    expect(querySelector.mock.calls.length).toBeLessThanOrEqual(2);
    expect(computedStyle.mock.calls.length).toBeGreaterThan(0);
    const selectorsAfterFirst = querySelector.mock.calls.length;
    const readsAfterFirst = computedStyle.mock.calls.length;

    // What actually matters: repeated calls add NO reads at all. This is the
    // path the controller takes on EVERY row estimate, and an earlier change in
    // this series put a querySelector plus a getComputedStyle on it and cost
    // 679ms of a 1 187ms bench-app test under jsdom.
    getGridRowBoxMetrics();
    getGridRowBoxMetrics();
    getGridRowBoxMetrics();

    expect(querySelector).toHaveBeenCalledTimes(selectorsAfterFirst);
    expect(computedStyle).toHaveBeenCalledTimes(readsAfterFirst);
  });

  test("descending to the laying-out element costs no extra read per estimate", () => {
    // The descent runs inside the one cached resolution, not per estimate. A
    // cell nested three deep must cost the same per-estimate zero as a flat one.
    const cell = renderCell("21px");
    let leaf: HTMLElement = cell;
    for (let depth = 0; depth < 3; depth += 1) {
      const span = document.createElement("span");
      span.setAttribute("style", "font: 14px/20.3px Inter");
      leaf.append(span);
      leaf = span;
    }
    leaf.textContent = "wrapped analyst copy";

    getGridRowBoxMetrics();
    const querySelector = vi.spyOn(document, "querySelector");
    const computedStyle = vi.spyOn(globalThis, "getComputedStyle");

    for (let call = 0; call < 5; call += 1) getGridRowBoxMetrics();

    expect(querySelector).not.toHaveBeenCalled();
    expect(computedStyle).not.toHaveBeenCalled();
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

/**
 * The estimator's two metric caches — the row box here and the grid's average
 * character width in `text-metrics` — describe one theme, and both used to be
 * read once per session and never again. A theme or density swap changes the
 * font, the line height and the cell padding together (Excel states 6/8/12px of
 * horizontal padding across its density tiers; Material states 16), so both
 * have to be re-read, and on the SAME signal: letting them drift apart would be
 * worse than the stale-but-consistent state they were in.
 *
 * The signal is the store `useResolvedHeights` / `useResolvedPx` already
 * subscribe to — one `MutationObserver` on `<html>`'s `data-theme`,
 * `data-density`, `class` and `style`. Every mounted surface subscribes through
 * it, so it is the mechanism that already knows.
 */
describe("theme-change invalidation of the estimator metric caches", () => {
  // The font shorthand carries the line height, which is how a real cell gets
  // one: no theme sets `line-height` on a cell, it comes out of the resolved
  // font. (jsdom also drops a separate `line-height` declaration when the
  // shorthand is present, so this is the only spelling that works here.)
  function renderCell(font = "14px/21px Inter"): HTMLElement {
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.setAttribute("data-pretable-wrap", "true");
    cell.setAttribute("style", `font: ${font}`);
    cell.textContent = "wrapped copy";
    document.body.append(cell);
    return cell;
  }

  /** A 2d context whose advance width depends on the font it is given. */
  function stubOffscreenCanvas(): { font: string } {
    const context = {
      font: "",
      measureText: (text: string) => ({
        width: text.length * (context.font.includes("Menlo") ? 8 : 6),
      }),
    };
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return context;
        }
      },
    );
    return context;
  }

  /** Mount a real subscriber, the way a surface does. */
  function mountStoreSubscriber(): () => void {
    const { unmount } = renderHook(() => useResolvedHeights());
    return unmount;
  }

  async function swapTheme(apply: () => void): Promise<void> {
    await act(async () => {
      apply();
      document.documentElement.setAttribute("data-theme", "material");
      // MutationObserver delivers on a microtask.
      await Promise.resolve();
    });
  }

  test("re-reads the row box after a theme change", async () => {
    const cell = renderCell();
    document.documentElement.style.setProperty(
      "--pretable-cell-padding-x",
      "6px",
    );
    expect(getGridRowBoxMetrics()).toEqual({
      lineHeightPx: 21,
      paddingXPx: 6,
      paddingYPx: 20.5,
      borderPx: 1,
    });

    const unmount = mountStoreSubscriber();
    await swapTheme(() => {
      document.documentElement.style.setProperty(
        "--pretable-cell-padding-x",
        "16px",
      );
      cell.setAttribute("style", "font: 14px/28px Inter");
    });

    expect(getGridRowBoxMetrics()).toEqual({
      lineHeightPx: 28,
      paddingXPx: 16,
      paddingYPx: 20.5,
      borderPx: 1,
    });
    unmount();
  });

  test("re-measures the grid character width on the same signal", async () => {
    resetTextMetricsCacheForTesting();
    const cell = renderCell();
    const context = stubOffscreenCanvas();
    expect(getGridAverageCharWidth()).toBeCloseTo(6, 5);
    expect(context.font).toBe("14px / 21px Inter");

    const unmount = mountStoreSubscriber();
    await swapTheme(() => {
      cell.setAttribute("style", "font: 11px/16px Menlo");
    });

    expect(getGridAverageCharWidth()).toBeCloseTo(8, 5);
    unmount();
    resetTextMetricsCacheForTesting();
  });

  test("rebinds the segment measurer on the same signal", async () => {
    // The measurer's identity IS the estimate memo key for the font. A swap
    // that changes the font must hand the estimator a different function, or
    // every already-estimated row keeps a height wrapped in the old one.
    resetTextMetricsCacheForTesting();
    const cell = renderCell();
    stubOffscreenCanvas();
    const before = getGridSegmentMeasurer();
    expect(before).not.toBeNull();

    const unmount = mountStoreSubscriber();
    await swapTheme(() => {
      cell.setAttribute("style", "font: 11px/16px Menlo");
    });

    const after = getGridSegmentMeasurer();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    unmount();
    resetTextMetricsCacheForTesting();
  });

  test("keeps the box's identity when the re-read resolves to the same numbers", async () => {
    // The estimate memo compares the box by identity, so an unrelated `class`
    // or `style` write on <html> must not hand it a new equal object and
    // re-run text layout for every row.
    renderCell();
    const before = getGridRowBoxMetrics();

    const unmount = mountStoreSubscriber();
    await act(async () => {
      document.documentElement.classList.add("something-unrelated");
      await Promise.resolve();
    });

    expect(getGridRowBoxMetrics()).toBe(before);
    document.documentElement.classList.remove("something-unrelated");
    unmount();
  });

  test("reads the DOM once per theme change, not once per estimate", async () => {
    // The guard the caching exists for: the controller asks for these on EVERY
    // row estimate, and a document-wide querySelector plus a getComputedStyle
    // on that path cost 679ms of a 1 187ms bench-app test under jsdom.
    resetTextMetricsCacheForTesting();
    renderCell();
    stubOffscreenCanvas();
    const unmount = mountStoreSubscriber();
    getGridRowBoxMetrics();
    getGridAverageCharWidth();

    const querySelector = vi.spyOn(document, "querySelector");
    const computedStyle = vi.spyOn(globalThis, "getComputedStyle");
    for (let index = 0; index < 50; index += 1) {
      getGridRowBoxMetrics();
      getGridAverageCharWidth();
      getGridSegmentMeasurer();
      getGridLetterSpacingPx();
    }

    expect(querySelector).not.toHaveBeenCalled();
    expect(computedStyle).not.toHaveBeenCalled();

    // And one swap costs one read each, not one per estimate after it.
    await swapTheme(() => undefined);
    for (let index = 0; index < 50; index += 1) {
      getGridRowBoxMetrics();
      getGridAverageCharWidth();
      getGridSegmentMeasurer();
      getGridLetterSpacingPx();
    }
    // Two, not four: the segment measurer and the letter spacing come off the
    // SAME cell read as the character width. Four callers, one DOM read each
    // for the box and for the text style.
    expect(querySelector).toHaveBeenCalledTimes(2);

    unmount();
    resetTextMetricsCacheForTesting();
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
