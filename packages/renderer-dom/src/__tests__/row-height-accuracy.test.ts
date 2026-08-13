import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import { createRowHeightCalibration } from "../row-height-calibration";
import {
  HERO_ROW_HEIGHT_SAMPLES,
  type RowHeightSample,
} from "./row-height-accuracy.fixture";

/**
 * The quantity this project exists to reduce, measured directly.
 *
 * The bench's `row_height_error_p95_px` compares two post-layout numbers and
 * never consults the estimator, so it can move without prediction improving and
 * improve without moving. This compares the estimator's own output against
 * heights a real browser produced.
 */

const THEME_ROW_HEIGHT = 48;

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

function errorsFor(
  calibration: ReturnType<typeof createRowHeightCalibration> | null,
): number[] {
  return HERO_ROW_HEIGHT_SAMPLES.map((sample) => {
    const estimate = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      calibration?.getParameters() ?? null,
    );
    return Math.abs(estimate - sample.heightPx);
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

describe("row height estimate accuracy against real measurements", () => {
  test("the fixture is substantial enough to conclude anything from", () => {
    expect(HERO_ROW_HEIGHT_SAMPLES.length).toBeGreaterThanOrEqual(20);
    expect(
      new Set(HERO_ROW_HEIGHT_SAMPLES.map((sample) => sample.heightPx)).size,
    ).toBeGreaterThanOrEqual(3);
  });

  test("calibration reduces estimator error against real rows", () => {
    const before = mean(errorsFor(null));

    // Warm up on half the samples, then score on all of them. Training on
    // everything and scoring on the same set would reward memorisation; this is
    // the cheapest honest split available for a fit with two parameters.
    const calibration = createRowHeightCalibration();
    for (const sample of HERO_ROW_HEIGHT_SAMPLES.slice(
      0,
      Math.floor(HERO_ROW_HEIGHT_SAMPLES.length / 2),
    )) {
      calibration.observe(
        predictRowLineCount({ analyst: sample.text }, columnsFor(sample)),
        sample.heightPx,
      );
    }

    const after = mean(errorsFor(calibration));

    // Record both in the output so the PR can quote them.
    console.log(`mean |estimate - measured|: ${before} -> ${after}`);
    expect(after).toBeLessThan(before);
  });
});
