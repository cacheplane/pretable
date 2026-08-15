import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import type { RowBoxMetrics } from "../types";

type Row = { id: string; label: string };

const row = (label: string): Row => ({ id: label, label });

/**
 * A deterministic font — every grapheme 10px — so line counts below are
 * arithmetic, and a COUNTING measurer, because the number of times the font is
 * consulted is the thing under test.
 */
function countingMeasurer(): {
  readonly measure: (segment: string) => number;
  calls: () => number;
} {
  let calls = 0;
  return {
    measure(segment: string) {
      calls += 1;
      return segment.length * 10;
    },
    calls: () => calls,
  };
}

const columns = [
  { id: "label", wrap: true, widthPx: 100, value: (r: Row) => r.label },
] as const;

const BOX: RowBoxMetrics = {
  lineHeightPx: 20,
  paddingYPx: 4,
  paddingXPx: 0,
  borderPx: 1,
  wrapMode: "wrap",
};

/**
 * `RowLayoutController.measure` calls `predictRowLineCount` for every measured
 * data row on every commit, to classify it for the height calibration. The
 * estimator has already computed that exact number for that exact row, from
 * the same inputs, and threw it away — so the calibration path re-prepared and
 * re-laid out every wrapped cell in the grid, once per commit.
 *
 * The line count does NOT depend on `baseHeight` or on the calibration itself,
 * which is why it can be shared across the two entry points at all.
 */
describe("the line count the estimator already computed", () => {
  test("predictRowLineCount reuses it instead of laying the text out again", () => {
    const font = countingMeasurer();
    const subject = row("aaaa bbbb cccc dddd");

    estimateDomRowHeight(
      subject,
      columns,
      44,
      null,
      10,
      BOX,
      font.measure,
      null,
      null,
    );
    const afterEstimate = font.calls();
    expect(afterEstimate).toBeGreaterThan(0);

    const lines = predictRowLineCount(
      subject,
      columns,
      10,
      BOX,
      font.measure,
      null,
      null,
    );

    expect(lines).toBe(2);
    expect(font.calls()).toBe(afterEstimate);
  });

  test("the reused count is the one a cold call computes", () => {
    // The correctness twin. A memo that returns a fast wrong number would pass
    // the test above on its own.
    for (const label of [
      "aaaa",
      "aaaa bbbb cccc dddd",
      "aaaa bbbb cccc dddd eeee ffff",
      "",
      "   ",
      "aaaaaaaaaaaaaaaaaaaaaaaa",
    ]) {
      const cold = countingMeasurer();
      const warm = countingMeasurer();
      const coldRow = row(label);
      const warmRow = row(label);

      const expected = predictRowLineCount(
        coldRow,
        columns,
        10,
        BOX,
        cold.measure,
        null,
        null,
      );

      estimateDomRowHeight(
        warmRow,
        columns,
        44,
        null,
        10,
        BOX,
        warm.measure,
        null,
        null,
      );
      const reused = predictRowLineCount(
        warmRow,
        columns,
        10,
        BOX,
        warm.measure,
        null,
        null,
      );

      expect(reused).toBe(expected);
    }
  });

  test("a changed cell value is not answered from the old row's count", () => {
    const font = countingMeasurer();
    const subject = row("aaaa");

    estimateDomRowHeight(
      subject,
      columns,
      44,
      null,
      10,
      BOX,
      font.measure,
      null,
      null,
    );
    expect(
      predictRowLineCount(subject, columns, 10, BOX, font.measure, null, null),
    ).toBe(1);

    // Same row OBJECT — the memo is a WeakMap keyed on it — with new text.
    subject.label = "aaaa bbbb cccc dddd eeee ffff";

    expect(
      predictRowLineCount(subject, columns, 10, BOX, font.measure, null, null),
    ).toBe(3);
  });

  test("a different box recomputes rather than reusing the first answer", () => {
    const font = countingMeasurer();
    const subject = row("aaaa bbbb cccc dddd");

    estimateDomRowHeight(
      subject,
      columns,
      44,
      null,
      10,
      BOX,
      font.measure,
      null,
      null,
    );

    // Padding narrows the text box to 80px, so no two 40px words fit on a line
    // with a 10px space between them and each takes its own. A memo blind to
    // the box would answer 2.
    const narrower: RowBoxMetrics = { ...BOX, paddingXPx: 10 };

    expect(
      predictRowLineCount(
        subject,
        columns,
        10,
        narrower,
        font.measure,
        null,
        null,
      ),
    ).toBe(4);
  });

  test("a row the estimator never saw is still answered correctly", () => {
    // The read-through path: nothing populated the memo, so this has to
    // compute — it must not return a default or throw.
    const font = countingMeasurer();

    expect(
      predictRowLineCount(
        row("aaaa bbbb cccc dddd"),
        columns,
        10,
        BOX,
        font.measure,
        null,
        null,
      ),
    ).toBe(2);
    expect(font.calls()).toBeGreaterThan(0);
  });
});
