import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import {
  createRowHeightCalibration,
  type RowHeightCalibrationParameters,
} from "../row-height-calibration";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
  HERO_RENDER_ADVANCES,
  HERO_ROW_BOX_METRICS,
  type HeroRowBoxMetrics,
  HERO_ROW_BOX_METRICS_CELL_LINE_HEIGHT,
  HERO_ROW_HEIGHT_SAMPLES,
  measureHeroSegment,
  type RowHeightSample,
} from "./row-height-accuracy.fixture";

/**
 * The estimator's BIAS, which mean absolute error cannot see.
 *
 * Since #342 a visible row's estimate is a one-frame placeholder — the DOM
 * measures it within a frame of appearing. What actually persists is the
 * **scroll extent**: the sum of estimates over thousands of rows that never
 * render, which sets the scrollbar and every row offset. The quantity that
 * governs it is the SIGNED aggregate `Σestimate − Σmeasured`, not the mean of
 * `|estimate − measured|` that `row-height-accuracy.test.ts` reports. A mean of
 * absolute errors is blind to systematic bias by construction: it cannot
 * distinguish "wrong in both directions" from "wrong in one".
 *
 * This file exists to settle one open question with data already in the repo:
 * the learned floor is a running **max** over ≤1-line rows, and a max is biased
 * high by construction. On the per-row objective it wins. This measures what
 * that costs in aggregate, against a **mean** floor computed here.
 *
 * ## The answer, and why it was not the expected one
 *
 * The premise was that the max floor buys per-row accuracy by paying scroll
 * extent — a scrollbar too TALL. Measured, the max floor's extent error is
 * **negative**: it under-states the extent. The mean floor is worse on both
 * objectives at once, so there is no trade to make here at all.
 *
 * The reason is visible in the "no calibration" reference line: with no floor,
 * 43 of 48 rows under-estimate and none over-estimates. The estimator's per-line
 * arithmetic is systematically a pixel or so short of what Chromium draws — the
 * residual `row-height-accuracy.test.ts` documents and Phase B targets — and it
 * dwarfs anything the floor does. The floor IS biased high, exactly as argued;
 * it is simply offsetting a larger negative bias, and lowering it to a mean
 * removes part of the offset without touching the cause.
 *
 * The consequence for whoever reads this later: "keep the max" rests on a
 * cancellation, not on the max being right. When the per-line shortfall is
 * fixed, this file must be re-run — the max's positive bias will stop being
 * hidden, and the answer can flip.
 *
 * ## Both estimator paths, not just the average one
 *
 * Phase B gave the estimator a second way to decide line breaks: real per-token
 * advance widths, instead of arithmetic on one average character width. Whether
 * that moves the shortfall above is the single most valuable thing that phase
 * can report — and until this file passed a measurer, it could not see it. Every
 * number here was the average path, and a reader would have had no way to tell.
 *
 * So every policy below is now reported TWICE, in two columns:
 *
 *   - **average**: `measureSegment` is `null`. `prepareText` wraps by
 *     `charsPerLine = floor(width / HERO_AVERAGE_CHAR_WIDTH_PX)`. These are the
 *     numbers this file printed before Phase B, kept unchanged so the comparison
 *     is a comparison and not a replacement.
 *   - **measured**: `measureHeroSegment` supplies this font's real per-token
 *     advance widths, captured in the same browser session the heights were, and
 *     `text-core` wraps by accumulated pixel width.
 *
 * Both columns read the SAME font. The only variable is average arithmetic
 * versus accumulated measurement, which is what makes the difference between
 * them attributable.
 *
 * Each floor is re-learned per path, not shared: the floor admits rows the
 * estimator predicts at <= 1 line, so a path that predicts different line counts
 * is entitled to a different floor. Sharing one would measure two estimators
 * against one estimator's calibration.
 *
 * ## What this sample can and cannot tell you
 *
 * 48 rows, from ONE grid (the homepage hero, at three wrap widths), and every
 * one of them was actually rendered. Real scroll extent is dominated by rows
 * that never render at all.
 *
 * - The bias **direction** generalises. It is a property of the estimator
 *   function, not of this sample: a running max over ≤1-line rows can only sit
 *   at or above the rows that fed it, and the per-line arithmetic is short of
 *   what the browser draws for the same reason on any grid.
 * - The bias **magnitude does not generalise**, and the percentage printed
 *   below is NOT a universal constant. It depends entirely on a grid's mix of
 *   wrapped and unwrapped rows: the floor only decides rows the estimator
 *   predicts at ≤1 line, so a grid that is mostly short rows will see far more
 *   of this bias than one that is mostly wrapped prose, and a grid with a
 *   different tall-renderer spread will see a different floor entirely.
 *
 * Quote the direction. Re-measure the magnitude on the grid you care about.
 *
 * This file changes no production code and asserts no answer to the max-vs-mean
 * question — an assertion there would pin whichever result happened to hold on
 * the day it was written. The console output is the deliverable.
 */

const THEME_ROW_HEIGHT = 48;

/**
 * ## Re-run for the render-advance work, and the answer moved
 *
 * The paragraph above says: "when the per-line shortfall is fixed, this file
 * must be re-run — the max's positive bias will stop being hidden, and the
 * answer can flip." That is this task. Two defects were fixed:
 *
 *   - line height resolved from the element that lays the text out (20.3px)
 *     rather than the cell (21px), and
 *   - the analyst column's render advance (a 59.39px stance badge) charged to
 *     the wrapped text's last word.
 *
 * So every policy is now reported under BOTH configurations — the corrected
 * one, which is what the floor decision is to be made on, and the one PR #370
 * measured, kept so the comparison is a comparison. The floor policy is NOT
 * changed here; this file still asserts no answer.
 */
type Configuration = {
  readonly label: string;
  readonly box: HeroRowBoxMetrics;
  readonly advances: ReadonlyMap<string, number> | null;
};

const CORRECTED: Configuration = {
  label:
    "corrected (line height 20.3px from the laying-out element + render advance)",
  box: HERO_ROW_BOX_METRICS,
  advances: HERO_RENDER_ADVANCES,
};

const AS_MEASURED_BY_370: Configuration = {
  label: "as PR #370 measured it (line height 21px from the cell, no advance)",
  box: HERO_ROW_BOX_METRICS_CELL_LINE_HEIGHT,
  advances: null,
};

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

/**
 * The same train/score split the accuracy instrument uses: warm on the first
 * half, score on all 48. Kept identical on purpose, so the numbers here are
 * directly comparable with the 3.500px it reports.
 */
const TRAINING_SAMPLES = HERO_ROW_HEIGHT_SAMPLES.slice(
  0,
  Math.floor(HERO_ROW_HEIGHT_SAMPLES.length / 2),
);

/**
 * `null` is the average-character-width path; `measureHeroSegment` is the
 * measured-segment path. Threaded through every function below rather than
 * fixed at the top, because the whole point is to report both.
 */
type SegmentMeasurer = ((segment: string) => number) | null;

const AVERAGE_PATH: SegmentMeasurer = null;
const MEASURED_PATH: SegmentMeasurer = measureHeroSegment;

function predictedLines(
  sample: RowHeightSample,
  measureSegment: SegmentMeasurer,
  configuration: Configuration = CORRECTED,
): number {
  return predictRowLineCount(
    { analyst: sample.text },
    columnsFor(sample),
    HERO_AVERAGE_CHAR_WIDTH_PX,
    configuration.box,
    measureSegment,
    null,
    configuration.advances,
  );
}

/** The floor exactly as it ships: a running max, via the real module. */
function maxFloorParameters(
  measureSegment: SegmentMeasurer,
  configuration: Configuration = CORRECTED,
): RowHeightCalibrationParameters | null {
  const calibration = createRowHeightCalibration();
  for (const sample of TRAINING_SAMPLES) {
    calibration.observe(
      predictedLines(sample, measureSegment, configuration),
      sample.heightPx,
    );
  }
  return calibration.getParameters();
}

/**
 * The counterfactual floor: a running mean over the same admitted rows.
 *
 * Computed here rather than by editing `row-height-calibration.ts`, because
 * this task measures a policy it does not adopt. The admission rule is copied
 * from the module — finite, positive, and predicted at ≤1 line — so the two
 * floors differ in the AGGREGATION and in nothing else.
 */
function meanFloorParameters(
  measureSegment: SegmentMeasurer,
  configuration: Configuration = CORRECTED,
): RowHeightCalibrationParameters | null {
  let total = 0;
  let count = 0;
  for (const sample of TRAINING_SAMPLES) {
    const lines = predictedLines(sample, measureSegment, configuration);
    if (!Number.isFinite(lines) || !Number.isFinite(sample.heightPx)) continue;
    if (sample.heightPx <= 0) continue;
    if (lines >= 2) continue;
    total += sample.heightPx;
    count += 1;
  }
  return count === 0 ? null : Object.freeze({ floorPx: total / count });
}

interface BiasReport {
  readonly floorPx: number | null;
  readonly estimatedExtentPx: number;
  readonly measuredExtentPx: number;
  /** Σestimate − Σmeasured. Positive means the scrollbar is too tall. */
  readonly signedAggregatePx: number;
  /** signedAggregatePx / Σmeasured, as a percentage. */
  readonly relativeExtentErrorPct: number;
  readonly meanAbsoluteErrorPx: number;
  readonly over: number;
  readonly under: number;
  readonly exact: number;
}

function measure(
  parameters: RowHeightCalibrationParameters | null,
  measureSegment: SegmentMeasurer,
  configuration: Configuration = CORRECTED,
): BiasReport {
  let estimatedExtentPx = 0;
  let measuredExtentPx = 0;
  let absoluteTotal = 0;
  let over = 0;
  let under = 0;
  let exact = 0;

  for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
    const estimate = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      parameters,
      HERO_AVERAGE_CHAR_WIDTH_PX,
      configuration.box,
      measureSegment,
      null,
      configuration.advances,
    );
    const error = estimate - sample.heightPx;
    estimatedExtentPx += estimate;
    measuredExtentPx += sample.heightPx;
    absoluteTotal += Math.abs(error);
    if (error > 0) over += 1;
    else if (error < 0) under += 1;
    else exact += 1;
  }

  const signedAggregatePx = estimatedExtentPx - measuredExtentPx;
  return {
    floorPx: parameters?.floorPx ?? null,
    estimatedExtentPx,
    measuredExtentPx,
    signedAggregatePx,
    relativeExtentErrorPct: (signedAggregatePx / measuredExtentPx) * 100,
    meanAbsoluteErrorPx: absoluteTotal / HERO_ROW_HEIGHT_SAMPLES.length,
    over,
    under,
    exact,
  };
}

function column(result: BiasReport, field: keyof BiasReport): string {
  const value = result[field];
  return typeof value === "number" ? value.toFixed(4) : "none";
}

function reportPair(
  label: string,
  average: BiasReport,
  measured: BiasReport,
): void {
  const row = (name: string, field: keyof BiasReport) =>
    `  ${name.padEnd(24)}${column(average, field).padStart(14)}${column(measured, field).padStart(14)}`;
  console.log(
    [
      `${label}:`,
      `  ${"".padEnd(24)}${"average".padStart(14)}${"measured".padStart(14)}`,
      row("floor px", "floorPx"),
      row("Σestimate px", "estimatedExtentPx"),
      row("Σmeasured px", "measuredExtentPx"),
      row("signed aggregate px", "signedAggregatePx"),
      row("relative extent %", "relativeExtentErrorPct"),
      row("mean |error| per row px", "meanAbsoluteErrorPx"),
      `  ${"directional split".padEnd(24)}` +
        `${`${average.over}/${average.under}/${average.exact}`.padStart(14)}` +
        `${`${measured.over}/${measured.under}/${measured.exact}`.padStart(14)}` +
        `   (over/under/exact of ${HERO_ROW_HEIGHT_SAMPLES.length})`,
    ].join("\n"),
  );
}

describe("estimator bias, measured as scroll extent", () => {
  test("the fixture still holds enough samples to aggregate over", () => {
    expect(HERO_ROW_HEIGHT_SAMPLES.length).toBeGreaterThanOrEqual(48);
  });

  test.each([
    ["CORRECTED", CORRECTED],
    ["AS MEASURED BY #370", AS_MEASURED_BY_370],
  ] as const)(
    "signed extent error, max floor vs mean floor, average path vs measured path — %s",
    (_name, configuration) => {
      console.log(`\n=== ${configuration.label} ===`);
      const maxFloor = {
        average: measure(
          maxFloorParameters(AVERAGE_PATH, configuration),
          AVERAGE_PATH,
          configuration,
        ),
        measured: measure(
          maxFloorParameters(MEASURED_PATH, configuration),
          MEASURED_PATH,
          configuration,
        ),
      };
      const meanFloor = {
        average: measure(
          meanFloorParameters(AVERAGE_PATH, configuration),
          AVERAGE_PATH,
          configuration,
        ),
        measured: measure(
          meanFloorParameters(MEASURED_PATH, configuration),
          MEASURED_PATH,
          configuration,
        ),
      };
      const noFloor = {
        average: measure(null, AVERAGE_PATH, configuration),
        measured: measure(null, MEASURED_PATH, configuration),
      };

      reportPair("max floor (as shipped)", maxFloor.average, maxFloor.measured);
      reportPair(
        "mean floor (counterfactual, computed in this test)",
        meanFloor.average,
        meanFloor.measured,
      );
      reportPair(
        "no calibration at all (reference)",
        noFloor.average,
        noFloor.measured,
      );

      console.log(
        [
          "the trade (average path):",
          `  scroll extent: max ${maxFloor.average.relativeExtentErrorPct.toFixed(4)}% vs mean ${meanFloor.average.relativeExtentErrorPct.toFixed(4)}%` +
            ` (difference ${(maxFloor.average.relativeExtentErrorPct - meanFloor.average.relativeExtentErrorPct).toFixed(4)} pp,` +
            ` ${(maxFloor.average.signedAggregatePx - meanFloor.average.signedAggregatePx).toFixed(4)}px over ${HERO_ROW_HEIGHT_SAMPLES.length} rows)`,
          `  per-row error: max ${maxFloor.average.meanAbsoluteErrorPx.toFixed(4)}px vs mean ${meanFloor.average.meanAbsoluteErrorPx.toFixed(4)}px` +
            ` (difference ${(meanFloor.average.meanAbsoluteErrorPx - maxFloor.average.meanAbsoluteErrorPx).toFixed(4)}px)`,
          "what segment measurement bought, per floor policy:",
          ...(
            [
              ["max floor", maxFloor],
              ["mean floor", meanFloor],
              ["no floor", noFloor],
            ] as const
          ).map(
            ([name, pair]) =>
              `  ${name.padEnd(11)} extent ${pair.average.relativeExtentErrorPct.toFixed(4)}% -> ${pair.measured.relativeExtentErrorPct.toFixed(4)}%` +
              ` (${(pair.measured.signedAggregatePx - pair.average.signedAggregatePx).toFixed(4)}px),` +
              ` mean |error| ${pair.average.meanAbsoluteErrorPx.toFixed(4)}px -> ${pair.measured.meanAbsoluteErrorPx.toFixed(4)}px,` +
              ` under ${pair.average.under} -> ${pair.measured.under}, over ${pair.average.over} -> ${pair.measured.over}`,
          ),
        ].join("\n"),
      );

      // The only assertions here. Which policy wins is the QUESTION this file
      // exists to inform, so it is deliberately not pinned: an assertion would
      // freeze today's answer and quietly outrank whoever reads the numbers.
      expect(Number.isFinite(maxFloor.average.relativeExtentErrorPct)).toBe(
        true,
      );
      expect(Number.isFinite(maxFloor.measured.relativeExtentErrorPct)).toBe(
        true,
      );
      expect(
        maxFloor.average.over + maxFloor.average.under + maxFloor.average.exact,
      ).toBe(HERO_ROW_HEIGHT_SAMPLES.length);
    },
  );

  test("the two configurations are two configurations", () => {
    // Guard for the pair of reports above, in the shape this series keeps
    // needing: if `configuration` failed to reach the estimator, both blocks
    // would print identical tables and read as "the fixes changed nothing".
    const corrected = measure(null, MEASURED_PATH, CORRECTED);
    const before = measure(null, MEASURED_PATH, AS_MEASURED_BY_370);
    expect(corrected.estimatedExtentPx).not.toBe(before.estimatedExtentPx);
  });

  test("the measured column is the measured path, not a second copy of the average one", () => {
    // Without this the whole right-hand column could be vacuous: a dropped
    // argument anywhere between here and `prepareText` would print two
    // identical columns and read as "segment measurement changed nothing",
    // which is precisely one of the conclusions this file is used to draw.
    //
    // A measurer that calls every token one pixel wide cannot wrap anything, so
    // every row must collapse to one line — and with no floor to raise them,
    // the estimated extent must fall below what the real measurer produces.
    const onePx = measure(null, () => 1);
    const measured = measure(null, MEASURED_PATH);
    expect(onePx.estimatedExtentPx).toBeLessThan(measured.estimatedExtentPx);

    // And the two real columns are computed from different inputs: the sample
    // that Phase B fixed must be predicted differently by the two paths.
    const disagreeing = HERO_ROW_HEIGHT_SAMPLES.filter(
      (sample) =>
        predictedLines(sample, AVERAGE_PATH) !==
        predictedLines(sample, MEASURED_PATH),
    );
    expect(disagreeing.length).toBeGreaterThan(0);
  });
});
