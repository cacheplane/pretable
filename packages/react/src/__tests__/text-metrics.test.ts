// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  getGridAverageCharWidth,
  measureAverageCharWidth,
  resetTextMetricsCacheForTesting,
} from "../text-metrics";

/**
 * The estimator's model of a font is one number: pixels per character. It was
 * never measured — `prepareText` guesses it by pattern-matching a font-key
 * string, and the key the grid passes matches none of its patterns, so every
 * grid silently got 7px. On the homepage hero that predicts 3 lines where the
 * browser draws 2, which is most of the estimator's total error.
 */

function stubCanvas(widthPerChar: number) {
  const context = {
    font: "",
    measureText: (text: string) => ({ width: text.length * widthPerChar }),
  };
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string) =>
      (tag === "canvas"
        ? { getContext: () => context }
        : {}) as unknown as HTMLElement,
  );
  return context;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetTextMetricsCacheForTesting();
});

describe("average character width", () => {
  test("measures the font it is given", () => {
    stubCanvas(6);
    expect(measureAverageCharWidth("14px Inter", "hello world")).toBeCloseTo(
      6,
      5,
    );
  });

  test("applies the font to the measuring context", () => {
    const context = stubCanvas(6);
    measureAverageCharWidth("14px Inter", "hello world");
    expect(context.font).toBe("14px Inter");
  });

  test("caches per font, so a session measures each font once", () => {
    stubCanvas(6);
    // Reached through `createElement` rather than `stubCanvas`'s return value
    // so the spy sits on the very object the module under test will resolve.
    const context = (
      document.createElement("canvas") as unknown as {
        getContext: (id: string) => { measureText: (text: string) => unknown };
      }
    ).getContext("2d");
    const measureText = vi.spyOn(context, "measureText");
    measureAverageCharWidth("14px Inter", "hello world");
    const callsAfterFirst = measureText.mock.calls.length;
    measureAverageCharWidth("14px Inter", "different sample text");
    expect(measureText.mock.calls.length).toBe(callsAfterFirst);
  });

  test("returns null without a canvas, so SSR keeps today's behaviour", () => {
    vi.spyOn(document, "createElement").mockImplementation(
      () => ({ getContext: () => null }) as unknown as HTMLElement,
    );
    expect(measureAverageCharWidth("14px Inter", "hello world")).toBeNull();
  });

  test("returns null for empty sample text rather than dividing by zero", () => {
    const context = stubCanvas(6);
    const measureText = vi.spyOn(context, "measureText");
    expect(measureAverageCharWidth("14px Inter", "")).toBeNull();
    // The null alone does not pin the guard: without it the divide by zero
    // yields NaN, which the finiteness check downstream also turns into null.
    // What the guard uniquely does is refuse to divide at all.
    expect(measureText).not.toHaveBeenCalled();
  });

  test("counts graphemes, not code units", () => {
    // "🚀🚀" is 2 graphemes and 4 code units. Dividing by code units would
    // halve the answer for emoji-bearing text.
    stubCanvas(10); // measureText returns text.length * 10 = 40
    const width = measureAverageCharWidth("14px Inter", "🚀🚀");
    expect(width).toBeCloseTo(20, 5);
  });
});

describe("the grid's own character width", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("returns null before any cell has rendered", () => {
    // The controller asks for this at construction time, when no cell exists.
    // Null there means "keep the guess", and nothing is cached, so the next ask
    // — after first paint — measures for real.
    stubCanvas(6);
    expect(getGridAverageCharWidth()).toBeNull();
  });

  test("measures the computed font of a rendered wrapped cell", () => {
    document.body.innerHTML = `<div data-pretable-cell="" style="font: 11px Menlo">narrow</div><div data-pretable-cell="" data-pretable-wrap="true" style="font: 14px Inter">wrapped copy</div>`;
    const context = stubCanvas(6);

    expect(getGridAverageCharWidth()).toBeCloseTo(6, 5);
    // The wrapped cell, not the first cell in the document: wrapped text is the
    // only content this width is ever applied to.
    expect(context.font).toBe("14px Inter");
  });

  test("samples the cell's own text rather than a corpus string", () => {
    document.body.innerHTML = `<div data-pretable-cell="" data-pretable-wrap="true" style="font: 14px Inter">wrapped copy</div>`;
    const context = stubCanvas(6);
    const measured = vi.spyOn(context, "measureText");

    getGridAverageCharWidth();

    expect(measured).toHaveBeenCalledWith("wrapped copy");
  });

  test("falls back to any cell when none of them wrap", () => {
    document.body.innerHTML = `<div data-pretable-cell="" style="font: 11px Menlo">narrow</div>`;
    const context = stubCanvas(6);

    expect(getGridAverageCharWidth()).toBeCloseTo(6, 5);
    expect(context.font).toBe("11px Menlo");
  });

  test("falls back to a fixed sample when the cell is empty", () => {
    // An empty sample would divide by zero, and `measureAverageCharWidth`
    // answers null for it — which would strand a grid whose first rendered cell
    // happens to be blank.
    document.body.innerHTML = `<div data-pretable-cell="" data-pretable-wrap="true" style="font: 14px Inter"></div>`;
    stubCanvas(6);

    expect(getGridAverageCharWidth()).toBeCloseTo(6, 5);
  });
});
