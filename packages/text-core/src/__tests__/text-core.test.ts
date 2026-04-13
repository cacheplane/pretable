import { describe, expect, test } from "vitest";

import {
  comparePreparedTextToDomTruth,
  layoutPreparedText,
  prepareText,
} from "../index";

describe("text-core", () => {
  test("prepareText returns a stable prepared record for the same text and font key", () => {
    const first = prepareText({
      text: "alpha beta gamma",
      fontKey: "Inter-400-14",
    });
    const second = prepareText({
      text: "alpha beta gamma",
      fontKey: "Inter-400-14",
    });

    expect(first).toEqual(second);
    expect(first.breakpoints.length).toBeGreaterThan(0);
    expect(first.graphemeCount).toBe(16);
  });

  test("layoutPreparedText returns deterministic line count and height for repeated calls", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: "Inter-400-14",
    });

    const first = layoutPreparedText(prepared, 84, { lineHeightPx: 18 });
    const second = layoutPreparedText(prepared, 84, { lineHeightPx: 18 });

    expect(first).toEqual(second);
  });

  test("narrow widths increase line count and height", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: "Inter-400-14",
    });

    const wide = layoutPreparedText(prepared, 224, { lineHeightPx: 20 });
    const narrow = layoutPreparedText(prepared, 56, { lineHeightPx: 20 });

    expect(narrow.lineCount).toBeGreaterThan(wide.lineCount);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  test("unwrapped layout keeps line count at one", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: "Inter-400-14",
    });

    const layout = layoutPreparedText(prepared, 56, {
      lineHeightPx: 18,
      wrapMode: "nowrap",
    });

    expect(layout.lineCount).toBe(1);
    expect(layout.overflowX).toBe(true);
  });

  test("comparePreparedTextToDomTruth returns an error payload instead of throwing when layouts diverge", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: "Inter-400-14",
    });

    expect(() =>
      comparePreparedTextToDomTruth(
        prepared,
        80,
        { lineHeightPx: 20 },
        (estimate) => ({
          lineCount: estimate.lineCount + 2,
          height: estimate.height + 40,
        }),
      ),
    ).not.toThrow();

    const result = comparePreparedTextToDomTruth(
      prepared,
      80,
      { lineHeightPx: 20 },
      (estimate) => ({
        lineCount: estimate.lineCount + 2,
        height: estimate.height + 40,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      reason: "line-count-and-height-mismatch",
      lineCountDelta: 2,
      heightDelta: 40,
    });
  });
});
