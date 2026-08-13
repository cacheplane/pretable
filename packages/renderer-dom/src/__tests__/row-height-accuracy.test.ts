import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import { createRowHeightCalibration } from "../row-height-calibration";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
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
  averageCharWidthPx: number | null = HERO_AVERAGE_CHAR_WIDTH_PX,
): number[] {
  return HERO_ROW_HEIGHT_SAMPLES.map((sample) => {
    const estimate = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      calibration?.getParameters() ?? null,
      averageCharWidthPx,
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
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
        ),
        sample.heightPx,
      );
    }

    const after = mean(errorsFor(calibration));

    // Record both in the output so the PR can quote them.
    console.log(`mean |estimate - measured|: ${before} -> ${after}`);
    expect(after).toBeLessThan(before);
  });

  test("measuring the font beats guessing its character width", () => {
    // The gate this work ships on. `null` is today's behaviour: `prepareText`
    // pattern-matches the font-key string, the key the grid passes matches none
    // of its patterns, and every grid gets 7px per character.
    const guessed = mean(errorsFor(null, null));
    const measured = mean(errorsFor(null, HERO_AVERAGE_CHAR_WIDTH_PX));

    console.log(
      `mean |estimate - measured|, guessed width -> measured width: ${guessed} -> ${measured}`,
    );
    expect(measured).toBeLessThan(guessed);
  });

  test("the sub-100-character samples predict two lines, not three", () => {
    // Height error can improve for the wrong reasons — a wrong line count and a
    // wrong line height cancel — so pin the line count itself.
    //
    // These three are the rows that actually flip: at the guessed 7px they
    // predict 3 lines where Chromium drew 2 (89px), and at the measured width
    // they predict 2.
    //
    // Not every 89px sample flips, and the assertion deliberately does not
    // claim they do:
    //   - Two samples ("Momentum strong into the print. ...", 88 and 89 chars)
    //     already predicted 2 at the guessed width, so they cannot improve.
    //   - Seven samples of 102-111 characters still predict 3 at the measured
    //     width, because 320px / 6.5055px is ~49 characters per line and the
    //     browser fits those into 2. A uniform average character width does not
    //     close that gap; per-string measurement would, and is out of scope.
    const flipping = [
      "Tracking crude + sector rotation. Unrealized still positive; no action vs target weight.hold",
      "Net-interest-income guide reaffirmed. Defensive ballast for the book; hold at weight.hold",
      "Headline risk on a regulatory probe. Flagged for review — drawdown breached the 2σ stop band.hold",
    ];

    for (const text of flipping) {
      const sample = HERO_ROW_HEIGHT_SAMPLES.find(
        (candidate) => candidate.text === text,
      );
      // Verbatim fixture rows only: a typo here must fail, not silently skip.
      expect(sample, `no fixture sample with text ${text}`).toBeDefined();
      if (sample === undefined) continue;
      expect(sample.heightPx).toBe(89);

      expect(
        predictRowLineCount({ analyst: sample.text }, columnsFor(sample)),
      ).toBe(3);
      expect(
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
        ),
      ).toBe(2);
    }
  });
});
