import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import { createRowHeightCalibration } from "../row-height-calibration";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
  HERO_ROW_BOX_METRICS,
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

/**
 * The hero's real box, passed to every estimate below.
 *
 * Defaulting this is the point of the phase: the samples were captured from a
 * grid whose cells are 21px-line-height with 16px of horizontal padding, so
 * estimating them with the no-box constants (24px lines, 42px chrome, no
 * padding deducted) measures the estimator with its main input switched off.
 * The `null` box is still exercised deliberately below, as the BEFORE number.
 */
const BOX = HERO_ROW_BOX_METRICS;

function errorsFor(
  calibration: ReturnType<typeof createRowHeightCalibration> | null,
  averageCharWidthPx: number | null = HERO_AVERAGE_CHAR_WIDTH_PX,
  boxMetrics: typeof BOX | null = BOX,
): number[] {
  return HERO_ROW_HEIGHT_SAMPLES.map((sample) => {
    const estimate = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      calibration?.getParameters() ?? null,
      averageCharWidthPx,
      boxMetrics,
    );
    return Math.abs(estimate - sample.heightPx);
  });
}

function warmedCalibration(
  boxMetrics: typeof BOX | null = BOX,
): ReturnType<typeof createRowHeightCalibration> {
  // Warm up on half the samples, then score on all of them. Training on
  // everything and scoring on the same set would reward memorisation; this is
  // the cheapest honest split available.
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
        boxMetrics,
      ),
      sample.heightPx,
    );
  }
  return calibration;
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
    const after = mean(errorsFor(warmedCalibration()));

    // Record both in the output so the PR can quote them.
    console.log(`mean |estimate - measured|: ${before} -> ${after}`);
    expect(after).toBeLessThan(before);
  });

  test("reading the box beats inferring it", () => {
    // The gate this phase ships on, in height terms. `null` is the estimator
    // with no box: 24px lines, 42px chrome, and a wrap width that spans the
    // column's padding as if text could be drawn on it. `BOX` is what
    // `getComputedStyle` says about the very cells these samples came from.
    //
    // The 6.85px this must beat is not an arbitrary bar. It is what the
    // now-deleted least-squares fit scored on this same fixture — a fit that
    // reached it by absorbing the padding error rather than modelling
    // anything. Beating it with the padding actually deducted, and with no fit
    // at all, is the claim.
    const inferred = mean(errorsFor(warmedCalibration(null), undefined, null));
    const read = mean(errorsFor(warmedCalibration()));

    console.log(
      `mean |estimate - measured|, inferred box -> box read from CSS: ${inferred} -> ${read}`,
    );
    expect(read).toBeLessThan(inferred);
    expect(read).toBeLessThan(6.85);
  });

  test("measuring the font beats guessing its character width", () => {
    // `null` width is the pre-#358 behaviour: `prepareText` pattern-matches the
    // font-key string, the key the grid passes matches none of its patterns,
    // and every grid gets 7px per character.
    //
    // The box is pinned to `null` here ON PURPOSE, and not because the box is
    // unavailable. This is the claim #358 made, in the configuration it made
    // it in, kept intact so the record of that decision survives. The
    // box-aware version of the same comparison is the next test, and it does
    // NOT come out the same way.
    const guessed = mean(errorsFor(null, null, null));
    const measured = mean(errorsFor(null, HERO_AVERAGE_CHAR_WIDTH_PX, null));

    console.log(
      `mean |estimate - measured| (no box), guessed width -> measured width: ${guessed} -> ${measured}`,
    );
    expect(measured).toBeLessThan(guessed);
  });

  test("with the real box, the 7px guess still wins on HEIGHT and loses on LINE COUNT", () => {
    // An uncomfortable result, recorded rather than smoothed over.
    //
    // Once the padding is deducted, the measured 6.505px character width
    // scores WORSE mean height error than the 7px guess — 3.5px against
    // 2.646px calibrated. That is not the guess being right. 7px is larger
    // than the font's real average advance, so it fits fewer characters on a
    // line and predicts MORE lines; the box-based estimate is systematically a
    // pixel or so short of what Chromium drew, and the extra line covers the
    // shortfall. It is the same wrong-but-cancelling arrangement this series
    // has spent three phases dismantling, one layer down.
    //
    // The line count is the measure that cannot cancel, which is exactly why
    // it was pinned separately in the first place, and there the measured
    // width wins decisively: 47/48 against 41/48. So the shipped estimator
    // keeps the measured width — it is right about the quantity it actually
    // models — and the residual per-line shortfall is Phase B's subject, where
    // segment-measured text replaces average-character-width arithmetic
    // altogether. Fixing it by restoring a wrong constant is not available.
    const guessedHeight = mean(errorsFor(warmedCalibration(null), null));
    const measuredHeight = mean(errorsFor(warmedCalibration()));

    let guessedLines = 0;
    let measuredLines = 0;
    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      if (
        predictRowLineCount({ analyst: sample.text }, columnsFor(sample), null, BOX) ===
        sample.lineCount
      ) {
        guessedLines += 1;
      }
      if (
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
          BOX,
        ) === sample.lineCount
      ) {
        measuredLines += 1;
      }
    }

    console.log(
      `with the real box — height error: guessed ${guessedHeight}, measured ${measuredHeight}; ` +
        `line counts /${HERO_ROW_HEIGHT_SAMPLES.length}: guessed ${guessedLines}, measured ${measuredLines}`,
    );

    expect(guessedHeight).toBeLessThan(measuredHeight);
    expect(measuredLines).toBeGreaterThan(guessedLines);
  });

  test("wrapping inside the cell fixes the LINE COUNT the font measurement exposed", () => {
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
    // The cause was never the character width. `predictRowLineCount` wrapped at
    // the full column width and never deducted the cell's 16px of horizontal
    // padding, so it always over-stated characters per line. The 7px guess
    // over-stated the character width by about the same factor, and the two
    // errors cancelled. Measuring the width honestly removed one half of that
    // accident and exposed the padding term — the regression #358 shipped
    // knowingly rather than paper over by reverting to the guess.
    //
    // This phase deducts the padding. The third column below is that fix, and
    // it is the gate: the claim is that reading the box beats guessing, so it
    // has to beat 43/48 — the number the GUESS reached — not merely 37/48,
    // which was our own correction's cost.
    //
    //   guessed 7px,            no box:  43/48
    //   measured 6.505112...px, no box:  37/48
    //   measured 6.505112...px, real box: pinned below
    let guessedCorrect = 0;
    let measuredCorrect = 0;
    let boxedCorrect = 0;
    const flips: {
      label: string;
      guessed: number;
      measured: number;
      drawn: number;
    }[] = [];
    const stillWrong: string[] = [];

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
      const boxed = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
      );
      if (guessed === sample.lineCount) guessedCorrect += 1;
      if (measured === sample.lineCount) measuredCorrect += 1;
      if (boxed === sample.lineCount) boxedCorrect += 1;
      else {
        stillWrong.push(
          `${sample.widthPx}px predicted ${boxed}, drawn ${sample.lineCount}: ${sample.text}`,
        );
      }
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

    console.log(
      `line counts correct /${HERO_ROW_HEIGHT_SAMPLES.length} — guessed width: ${guessedCorrect}, measured width: ${measuredCorrect}, measured width + real box: ${boxedCorrect}`,
    );
    if (stillWrong.length > 0) {
      console.log(`still wrong with the real box:\n  ${stillWrong.join("\n  ")}`);
    }

    expect({ guessedCorrect, measuredCorrect, boxedCorrect }).toEqual({
      guessedCorrect: 43,
      measuredCorrect: 37,
      boxedCorrect: 47,
    });

    // The gate, stated as an inequality as well as an exact count, so that a
    // future change that moves the count has to move it in the right direction
    // to survive: 43 is what the guess achieved, and reading the box has to
    // beat it, not tie it.
    expect(boxedCorrect).toBeGreaterThan(guessedCorrect);

    // Every no-box flip was a regression, and remains one. This is the record
    // of what #358 cost, kept because the fix is only meaningful against it.
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
