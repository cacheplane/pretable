import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
  HERO_ROW_BOX_METRICS,
  HERO_ROW_HEIGHT_SAMPLES,
  HERO_SEGMENT_WIDTHS_PX,
  measureHeroSegment,
  type RowHeightSample,
} from "./row-height-accuracy.fixture";

/**
 * WHERE the remaining under-estimate comes from, decomposed rather than averaged.
 *
 * `row-height-bias.test.ts` reports that with the learned floor disabled, 43 of
 * 48 rows under-estimate and none over-estimates, for -432px of signed extent —
 * and that segment measurement (#367) moved that split by zero rows. This file
 * asks which term that is. It changes no production code, and it asserts no
 * cause: the console output is the deliverable, and pinning a cause here would
 * outrank whoever reads the numbers next.
 *
 * Three quantities have to be separated before any of it means anything, and
 * the fixture is the only place all three are available at once:
 *
 *   - `lineCount` — how many lines Chromium wrapped the RAW value into. The
 *     estimator's target.
 *   - `heightPx` — the height the ROW settled on: the max over every cell,
 *     including the two-line `dayPnl` renderer that has nothing to do with the
 *     analyst text.
 *   - `HERO_SEGMENT_WIDTHS_PX` — this font's real advance widths, which make
 *     the horizontal slack left on a row's last line computable here, in Node.
 *
 * The rendered analyst cell is NOT the raw value: a `render` prop appends an
 * inline-flex stance badge (`hold` / `watch` / `trim` / `risk`) after the text.
 * It takes horizontal space and can therefore push the text onto a line the
 * estimator, which sees only the raw string, cannot predict. The fixture's
 * header says this outright and calls it "removable from the TEXT but not from
 * the HEIGHT". This file measures how much height that actually is.
 */

const THEME_ROW_HEIGHT = 48;
const BOX = HERO_ROW_BOX_METRICS;

/** Cell padding both sides + the cell's bottom rule. 12*2 + 1. */
const CHROME_PX = BOX.paddingYPx * 2 + BOX.borderPx;

function columnsFor(sample: RowHeightSample) {
  return [
    {
      id: "analyst",
      wrap: true,
      widthPx: sample.widthPx,
      value: (row: { analyst: string }) => row.analyst,
    },
  ] as const;
}

/** The shipped estimator, floor disabled — the reference line this file explains. */
function estimateFor(sample: RowHeightSample): number {
  return estimateDomRowHeight(
    { analyst: sample.text },
    columnsFor(sample),
    THEME_ROW_HEIGHT,
    null,
    HERO_AVERAGE_CHAR_WIDTH_PX,
    BOX,
    measureHeroSegment,
  );
}

function predictedLinesFor(sample: RowHeightSample): number {
  return predictRowLineCount(
    { analyst: sample.text },
    columnsFor(sample),
    HERO_AVERAGE_CHAR_WIDTH_PX,
    BOX,
    measureHeroSegment,
  );
}

/**
 * Greedy wrap over the captured advance widths, reporting the LAST line's
 * width as well as the line count.
 *
 * A local reimplementation, because `layoutPreparedText` returns the widest
 * line and this needs the last one — the only place a trailing badge can go.
 * It is not taken on trust: the report prints how many of the 48 rows it
 * agrees with `predictRowLineCount` on, and if that is ever less than 48 every
 * slack number below it is worthless.
 */
function wrapWithLastLine(
  text: string,
  availableWidth: number,
): { lineCount: number; lastLineWidth: number } {
  const spaceWidth = measureHeroSegment(" ");
  const words = text.split(" ");
  let lineCount = 1;
  let lastLineWidth = measureHeroSegment(words[0] ?? "");
  for (const word of words.slice(1)) {
    const wordWidth = measureHeroSegment(word);
    if (lastLineWidth + spaceWidth + wordWidth <= availableWidth) {
      lastLineWidth += spaceWidth + wordWidth;
    } else {
      lineCount += 1;
      lastLineWidth = wordWidth;
    }
  }
  return { lineCount, lastLineWidth };
}

/**
 * The rendered line count of the analyst cell, read back out of the measured
 * row height.
 *
 * Only four heights occur across all 48 samples, at three wrap widths — 63, 68,
 * 89, 109 — and they step by ~21 from 68 upward, which is one line of this
 * font. 63 is the odd one: it is BELOW 68 yet above one line of text plus
 * chrome (46), so it is the height of some other cell in the row, not of the
 * analyst text.
 *
 * This inversion is a hypothesis, and the report cross-checks it two ways that
 * could each have failed: every row's inferred count must land in
 * {lineCount, lineCount + 1} (the badge can add at most one line), and the same
 * counts must be reproducible from horizontal slack alone.
 */
const RENDERED_LINES_BY_HEIGHT: Readonly<Record<number, number>> = {
  63: 1,
  68: 2,
  89: 3,
  109: 4,
};

interface Analysed {
  readonly sample: RowHeightSample;
  readonly estimate: number;
  readonly residual: number;
  readonly predictedLines: number;
  readonly renderedLines: number | undefined;
  readonly lastLineSlackPx: number;
  readonly localLineCount: number;
}

function analyse(): Analysed[] {
  return HERO_ROW_HEIGHT_SAMPLES.map((sample) => {
    const availableWidth = sample.widthPx - BOX.paddingXPx * 2;
    const { lineCount, lastLineWidth } = wrapWithLastLine(
      sample.text,
      availableWidth,
    );
    const estimate = estimateFor(sample);
    return {
      sample,
      estimate,
      residual: estimate - sample.heightPx,
      predictedLines: predictedLinesFor(sample),
      renderedLines: RENDERED_LINES_BY_HEIGHT[sample.heightPx],
      lastLineSlackPx: availableWidth - lastLineWidth,
      localLineCount: lineCount,
    };
  });
}

function bucket<K extends string | number>(
  rows: readonly Analysed[],
  key: (row: Analysed) => K,
): Map<K, Analysed[]> {
  const buckets = new Map<K, Analysed[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = buckets.get(k);
    if (existing) existing.push(row);
    else buckets.set(k, [row]);
  }
  return buckets;
}

function describeBucket(rows: readonly Analysed[]): string {
  const residuals = rows.map((row) => row.residual);
  const total = residuals.reduce((sum, value) => sum + value, 0);
  const distinct = [...new Set(residuals)].sort((a, b) => a - b);
  return (
    `n=${String(rows.length).padStart(2)}` +
    `  Σresidual=${String(total).padStart(5)}px` +
    `  mean=${(total / rows.length).toFixed(4).padStart(9)}px` +
    `  distinct={${distinct.join(", ")}}`
  );
}

function reportBuckets(
  label: string,
  rows: readonly Analysed[],
  key: (row: Analysed) => string | number,
): void {
  const buckets = bucket(rows, key);
  const lines = [...buckets.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([k, group]) => `  ${String(k).padEnd(14)}${describeBucket(group)}`);
  console.log([`${label}:`, ...lines].join("\n"));
}

describe("the residual under-estimate, decomposed", () => {
  test("the fixture still holds the 48 samples this decomposition is built on", () => {
    expect(HERO_ROW_HEIGHT_SAMPLES.length).toBe(48);
  });

  test("hand sanity check: chrome + L x lineHeight against the four measured heights", () => {
    const measuredHeights = [
      ...new Set(HERO_ROW_HEIGHT_SAMPLES.map((s) => s.heightPx)),
    ].sort((a, b) => a - b);

    console.log(
      [
        "hand check — chrome = 2 x paddingY + border = " +
          `2 x ${BOX.paddingYPx} + ${BOX.borderPx} = ${CHROME_PX}; ` +
          `lineHeight (read from the CELL) = ${BOX.lineHeightPx}`,
        `  distinct measured heights: ${measuredHeights.join(", ")}`,
        ...[1, 2, 3, 4, 5].map((lines) => {
          const arithmetic = CHROME_PX + lines * BOX.lineHeightPx;
          const hit = measuredHeights.find(
            (height) => Math.abs(height - arithmetic) <= 1,
          );
          return (
            `  ${CHROME_PX} + ${lines} x ${BOX.lineHeightPx} = ${String(arithmetic).padStart(3)}` +
            (hit === undefined
              ? "   (no measured height within 1px)"
              : `   nearest measured ${hit} -> measured - arithmetic = ${hit - arithmetic}`)
          );
        }),
      ].join("\n"),
    );
  });

  test("signed residual by line count, by text emptiness, and by rendered-line inference", () => {
    const rows = analyse();

    const agreement = rows.filter(
      (row) => row.localLineCount === row.predictedLines,
    ).length;
    console.log(
      `local wrap agrees with predictRowLineCount on ${agreement}/${rows.length} rows` +
        " (if this is not 48, every slack number below is meaningless)",
    );

    const signed = rows.reduce((sum, row) => sum + row.residual, 0);
    const absolute = rows.reduce((sum, row) => sum + Math.abs(row.residual), 0);
    console.log(
      `floor disabled: Σresidual=${signed}px, mean |error|=${(absolute / rows.length).toFixed(4)}px, ` +
        `over/under/exact=${rows.filter((r) => r.residual > 0).length}/` +
        `${rows.filter((r) => r.residual < 0).length}/` +
        `${rows.filter((r) => r.residual === 0).length}`,
    );

    reportBuckets(
      "A. by PREDICTED line count (what the estimator built its number from)",
      rows,
      (row) => `lines=${row.predictedLines}`,
    );

    reportBuckets(
      "B. by raw text emptiness (an empty analyst value means another cell decides the row)",
      rows,
      (row) => (row.sample.text.trim().length === 0 ? "empty" : "non-empty"),
    );

    reportBuckets(
      "C. by measured height (the row's height is the max over ALL its cells)",
      rows,
      (row) => `measured=${row.sample.heightPx}`,
    );

    // The inference, and both cross-checks on it.
    const inferable = rows.filter((row) => row.renderedLines !== undefined);
    const inRange = inferable.filter(
      (row) =>
        row.renderedLines === row.predictedLines ||
        row.renderedLines === row.predictedLines + 1,
    );
    console.log(
      [
        "D. rendered lines inferred from measured height (63->1, 68->2, 89->3, 109->4):",
        `  inferable ${inferable.length}/${rows.length};` +
          ` inferred count within {predicted, predicted+1} on ${inRange.length}/${inferable.length}` +
          " (a badge can add at most one line, so anything outside refutes the inversion)",
      ].join("\n"),
    );

    reportBuckets(
      "E. by whether the badge added a line (inferred rendered > predicted)",
      inferable,
      (row) =>
        row.renderedLines === row.predictedLines ? "badge fits" : "badge wraps",
    );

    reportBuckets(
      "F. by INFERRED rendered line count",
      inferable,
      (row) => `rendered=${row.renderedLines}`,
    );

    // The same residual, recomputed as if the estimator had known the rendered
    // line count. What survives is the arithmetic error alone.
    const arithmeticOnly = inferable.map((row) => ({
      ...row,
      residual:
        Math.max(
          THEME_ROW_HEIGHT,
          CHROME_PX + (row.renderedLines ?? 0) * BOX.lineHeightPx,
        ) - row.sample.heightPx,
    }));
    reportBuckets(
      "G. residual if the estimator had known the rendered line count, by rendered lines",
      arithmeticOnly,
      (row) => `rendered=${row.renderedLines}`,
    );

    const arithmeticTotal = arithmeticOnly.reduce(
      (sum, row) => sum + row.residual,
      0,
    );
    console.log(
      [
        "H. additive split of the signed total:",
        `  total                                   ${signed}px`,
        `  attributable to line count the estimator could not see   ${signed - arithmeticTotal}px`,
        `  remaining, with the line count correct                   ${arithmeticTotal}px`,
      ].join("\n"),
    );

    // Independent check on the badge: a single inline advance (its own width
    // plus its 6px margin) that explains the SAME rendered-line assignment,
    // derived from horizontal slack instead of from height. If the interval
    // below is empty, the badge story is wrong.
    const fits = inferable.filter(
      (row) => row.renderedLines === row.predictedLines,
    );
    const wraps = inferable.filter(
      (row) => row.renderedLines === row.predictedLines + 1,
    );
    const lower = Math.max(...wraps.map((row) => row.lastLineSlackPx));
    const upper = Math.min(...fits.map((row) => row.lastLineSlackPx));
    console.log(
      [
        "I. badge inline advance implied by horizontal slack (independent of every height above):",
        `  must exceed the slack of all ${wraps.length} wrapped rows:  > ${lower.toFixed(4)}px`,
        `  must fit in the slack of all ${fits.length} fitting rows:   <= ${upper.toFixed(4)}px`,
        `  feasible interval: ${lower < upper ? `(${lower.toFixed(4)}, ${upper.toFixed(4)}] px — NON-EMPTY` : "EMPTY — the badge cannot explain these line counts"}`,
      ].join("\n"),
    );

    // What line advance `a` and last-line box height `B` are consistent with
    // the measured heights, given the row height is Math.ceil()ed by
    // `measureRenderedRowHeight`. Bounds only; no fitting.
    const constraints = [2, 3, 4]
      .map((lines) => {
        const height = Object.entries(RENDERED_LINES_BY_HEIGHT).find(
          ([, value]) => value === lines,
        )?.[0];
        return height === undefined
          ? null
          : {
              lines,
              height: Number(height),
              lo: Number(height) - 1 - CHROME_PX,
              hi: Number(height) - CHROME_PX,
            };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    console.log(
      [
        "J. what line advance is consistent with ceil(chrome + (n-1)a + B) = measured:",
        ...constraints.map(
          (c) =>
            `  n=${c.lines}: ${c.lo} < ${c.lines - 1}a + B <= ${c.hi}   (measured ${c.height})`,
        ),
        ...constraints.slice(1).map((c, index) => {
          const prev = constraints[index];
          if (prev === undefined) return "";
          return `  n=${prev.lines} vs n=${c.lines}:  ${c.lo - prev.hi} < a < ${c.hi - prev.lo}`;
        }),
        `  intersection over both pairs: ${Math.max(
          ...constraints.slice(1).map((c, index) => {
            const prev = constraints[index];
            return prev === undefined ? -Infinity : c.lo - prev.hi;
          }),
        )} < a < ${Math.min(
          ...constraints.slice(1).map((c, index) => {
            const prev = constraints[index];
            return prev === undefined ? Infinity : c.hi - prev.lo;
          }),
        )}`,
        `  CSS on the wrapping element (.analyst) states line-height: 1.45 on a 14px font = ${(1.45 * 14).toFixed(2)}px`,
        `  the estimator reads ${BOX.lineHeightPx}px, from the CELL`,
        ...(() => {
          // With `a` taken from that CSS rather than fitted, what last-line box
          // height B is left? One free parameter against three constraints, so
          // an empty interval would refute the model outright.
          const a = 1.45 * 14;
          const lo = Math.max(
            ...constraints.map((c) => c.lo - (c.lines - 1) * a),
          );
          const hi = Math.min(
            ...constraints.map((c) => c.hi - (c.lines - 1) * a),
          );
          return [
            `  with a = ${a.toFixed(2)}px, the last line box B must satisfy ${lo.toFixed(4)} < B <= ${hi.toFixed(4)}` +
              (lo < hi ? " — NON-EMPTY" : " — EMPTY"),
          ];
        })(),
      ].join("\n"),
    );

    // The only assertions. What the numbers MEAN is the finding, not a known,
    // so nothing here pins a cause.
    expect(rows).toHaveLength(48);
    for (const row of rows) {
      expect(Number.isFinite(row.residual)).toBe(true);
    }
    expect(Object.keys(HERO_SEGMENT_WIDTHS_PX).length).toBeGreaterThan(0);
  });
});
