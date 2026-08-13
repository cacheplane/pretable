import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import {
  createRowHeightCalibration,
  type RowHeightCalibrationParameters,
} from "../row-height-calibration";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
  HERO_ROW_BOX_METRICS,
  HERO_ROW_HEIGHT_SAMPLES,
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

const BOX = HERO_ROW_BOX_METRICS;

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

function predictedLines(sample: RowHeightSample): number {
  return predictRowLineCount(
    { analyst: sample.text },
    columnsFor(sample),
    HERO_AVERAGE_CHAR_WIDTH_PX,
    BOX,
  );
}

/** The floor exactly as it ships: a running max, via the real module. */
function maxFloorParameters(): RowHeightCalibrationParameters | null {
  const calibration = createRowHeightCalibration();
  for (const sample of TRAINING_SAMPLES) {
    calibration.observe(predictedLines(sample), sample.heightPx);
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
function meanFloorParameters(): RowHeightCalibrationParameters | null {
  let total = 0;
  let count = 0;
  for (const sample of TRAINING_SAMPLES) {
    const lines = predictedLines(sample);
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
      BOX,
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

function report(label: string, result: BiasReport): void {
  console.log(
    [
      `${label}:`,
      `  floor:                  ${result.floorPx === null ? "none" : `${result.floorPx}px`}`,
      `  Σestimate:              ${result.estimatedExtentPx}px`,
      `  Σmeasured:              ${result.measuredExtentPx}px`,
      `  signed aggregate error: ${result.signedAggregatePx > 0 ? "+" : ""}${result.signedAggregatePx}px`,
      `  relative extent error:  ${result.relativeExtentErrorPct > 0 ? "+" : ""}${result.relativeExtentErrorPct.toFixed(4)}%`,
      `  mean |error| per row:   ${result.meanAbsoluteErrorPx}px`,
      `  directional split:      ${result.over} over, ${result.under} under, ${result.exact} exact (of ${HERO_ROW_HEIGHT_SAMPLES.length})`,
    ].join("\n"),
  );
}

describe("estimator bias, measured as scroll extent", () => {
  test("the fixture still holds enough samples to aggregate over", () => {
    expect(HERO_ROW_HEIGHT_SAMPLES.length).toBeGreaterThanOrEqual(48);
  });

  test("signed extent error, max floor vs mean floor", () => {
    const maxFloor = measure(maxFloorParameters());
    const meanFloor = measure(meanFloorParameters());
    const noFloor = measure(null);

    report("max floor (as shipped)", maxFloor);
    report("mean floor (counterfactual, computed in this test)", meanFloor);
    report("no calibration at all (reference)", noFloor);

    console.log(
      [
        "the trade:",
        `  scroll extent: max ${maxFloor.relativeExtentErrorPct.toFixed(4)}% vs mean ${meanFloor.relativeExtentErrorPct.toFixed(4)}%` +
          ` (difference ${(maxFloor.relativeExtentErrorPct - meanFloor.relativeExtentErrorPct).toFixed(4)} pp,` +
          ` ${(maxFloor.signedAggregatePx - meanFloor.signedAggregatePx).toFixed(4)}px over ${HERO_ROW_HEIGHT_SAMPLES.length} rows)`,
        `  per-row error: max ${maxFloor.meanAbsoluteErrorPx.toFixed(4)}px vs mean ${meanFloor.meanAbsoluteErrorPx.toFixed(4)}px` +
          ` (difference ${(meanFloor.meanAbsoluteErrorPx - maxFloor.meanAbsoluteErrorPx).toFixed(4)}px)`,
      ].join("\n"),
    );

    // The only assertions here. Which policy wins is the QUESTION this file
    // exists to inform, so it is deliberately not pinned: an assertion would
    // freeze today's answer and quietly outrank whoever reads the numbers.
    expect(Number.isFinite(maxFloor.relativeExtentErrorPct)).toBe(true);
    expect(maxFloor.over + maxFloor.under + maxFloor.exact).toBe(
      HERO_ROW_HEIGHT_SAMPLES.length,
    );
  });
});
