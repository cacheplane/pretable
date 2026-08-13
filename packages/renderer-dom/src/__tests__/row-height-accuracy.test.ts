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

  test("measuring the font currently makes the LINE COUNT worse, not better", () => {
    // Height error can improve for the wrong reasons — a wrong line count and a
    // wrong line height cancel — so the line count is pinned separately. It is
    // pinned against `sample.lineCount`, the line boxes Chromium actually drew,
    // NOT against a line count inferred from `heightPx`.
    //
    // That distinction reversed the result. The previous version of this test
    // read "89px" as "2 lines" and asserted that three rows improved by
    // flipping 3 -> 2. The row height is the max over every cell, and this hero
    // has a two-line `dayPnl` renderer, so 89px says nothing about the analyst
    // cell. Measured directly, those rows are 3 lines. The flip was a
    // regression being pinned as an improvement.
    //
    // Against the measured truth, over all 48 samples:
    //   - guessed 7px:              43/48 correct
    //   - measured 6.505112...px:   37/48 correct
    //   - 6 samples change, and ALL SIX go from correct to wrong. No sample
    //     goes the other way.
    //
    // The cause is not the character width. `predictRowLineCount` wraps at the
    // full column width and never deducts the cell's horizontal padding, so it
    // always over-states characters per line. The 7px guess over-states the
    // character width by about the same factor, and the two errors cancelled.
    // Measuring the width honestly removes one half of that accident and
    // exposes the padding term, which is a separate, unfixed bug in
    // `create-renderer.ts` — out of scope here, and deliberately not papered
    // over by reverting to the guess.
    //
    // Height error still improves (see the gate above): the calibration's
    // line-height and floor terms absorb the line-count error. This test exists
    // so that stays visible instead of being cashed in as a line-count win.
    let guessedCorrect = 0;
    let measuredCorrect = 0;
    const flips: {
      label: string;
      guessed: number;
      measured: number;
      drawn: number;
    }[] = [];

    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      const guessed = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
      );
      const measured = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
        HERO_AVERAGE_CHAR_WIDTH_PX,
      );
      if (guessed === sample.lineCount) guessedCorrect += 1;
      if (measured === sample.lineCount) measuredCorrect += 1;
      if (guessed !== measured) {
        // The prediction pair is carried, not re-looked-up: the same string
        // appears at all three widths, so finding it back by text alone would
        // silently grade the 320px row instead of the one that flipped.
        flips.push({
          label: `${sample.widthPx}px ${guessed}->${measured} (drawn ${sample.lineCount}): ${sample.text}`,
          guessed,
          measured,
          drawn: sample.lineCount,
        });
      }
    }

    expect({ guessedCorrect, measuredCorrect }).toEqual({
      guessedCorrect: 43,
      measuredCorrect: 37,
    });

    // Every flip is a regression. If a future change makes one an improvement,
    // this fails and the counts above must be re-derived, not edited to fit.
    expect(flips).toHaveLength(6);
    for (const flip of flips) {
      expect(flip.guessed, `guessed should be right for ${flip.label}`).toBe(
        flip.drawn,
      );
      expect(
        flip.measured,
        `measured should be wrong for ${flip.label}`,
      ).not.toBe(flip.drawn);
    }
  });

  test("no sample is a line count the browser never drew", () => {
    // Guards the fixture itself: `lineCount` is a captured measurement, so a
    // zero or a negative means the probe was edited rather than re-run.
    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      expect(sample.lineCount).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(sample.lineCount)).toBe(true);
    }
  });
});
