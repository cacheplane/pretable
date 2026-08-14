import { describe, expect, test } from "vitest";

import { estimateDomRowHeight, predictRowLineCount } from "../create-renderer";
import type { RenderAdvances } from "../types";
import { createRowHeightCalibration } from "../row-height-calibration";
import {
  HERO_AVERAGE_CHAR_WIDTH_PX,
  HERO_RENDER_ADVANCE_PX,
  HERO_RENDER_ADVANCES,
  HERO_RENDER_ADVANCES_WITH_LINE_BOX,
  HERO_ROW_BOX_METRICS,
  HERO_ROW_BOX_METRICS_CELL_LINE_HEIGHT,
  HERO_ROW_HEIGHT_SAMPLES,
  HERO_WHITESPACE_SAMPLES,
  HERO_WRAP_MODE,
  measureHeroSegment,
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

/**
 * `null` measurer is the average-character-width path — everything this
 * fixture measured through Phase A. `measureHeroSegment` is the measured path:
 * real per-token advance widths for this font, captured from the same browser
 * the heights came from.
 */
type SegmentMeasurer = ((segment: string) => number) | null;

/**
 * The render advance, threaded but defaulted OFF.
 *
 * Every test written before this task passes no advance and therefore reports
 * exactly what it reported then; the gate test below is the only one that turns
 * it on, and it turns it on in both columns of an explicit comparison. That is
 * deliberate: the historical tests are the record of decisions this series made,
 * and silently re-scoring them under a new input would erase what they recorded.
 */
type Advances = RenderAdvances | null;

function errorsFor(
  calibration: ReturnType<typeof createRowHeightCalibration> | null,
  averageCharWidthPx: number | null = HERO_AVERAGE_CHAR_WIDTH_PX,
  boxMetrics: typeof BOX | null = BOX,
  measureSegment: SegmentMeasurer = null,
  renderAdvances: Advances = null,
): number[] {
  return HERO_ROW_HEIGHT_SAMPLES.map((sample) => {
    const estimate = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      calibration?.getParameters() ?? null,
      averageCharWidthPx,
      boxMetrics,
      measureSegment,
      null,
      renderAdvances,
    );
    return Math.abs(estimate - sample.heightPx);
  });
}

function correctLineCounts(
  measureSegment: SegmentMeasurer,
  boxMetrics: typeof BOX | null = BOX,
  renderAdvances: Advances = null,
): number {
  let correct = 0;
  for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
    const predicted = predictRowLineCount(
      { analyst: sample.text },
      columnsFor(sample),
      HERO_AVERAGE_CHAR_WIDTH_PX,
      boxMetrics,
      measureSegment,
      null,
      renderAdvances,
    );
    if (predicted === sample.lineCount) correct += 1;
  }
  return correct;
}

function warmedCalibration(
  boxMetrics: typeof BOX | null = BOX,
  measureSegment: SegmentMeasurer = null,
  renderAdvances: Advances = null,
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
        measureSegment,
        null,
        renderAdvances,
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
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          null,
          BOX,
        ) === sample.lineCount
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
      console.log(
        `still wrong with the real box:\n  ${stillWrong.join("\n  ")}`,
      );
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

  test("measuring every token against measuring one average", () => {
    // Phase B's subject, on the instrument that has held at 47/48 and 3.5px
    // since Phase A. Both columns read the SAME font: the average is that
    // font's real average advance, and the segment widths are that font's real
    // per-token advances. The only variable is whether wrapping is decided by
    // arithmetic on an average or by accumulated measured widths.
    //
    // Reported, not tuned. The gate verdict is Task 6's.
    const averageLines = correctLineCounts(null);
    const segmentLines = correctLineCounts(measureHeroSegment);
    const averageHeight = mean(errorsFor(warmedCalibration()));
    const segmentHeight = mean(
      errorsFor(
        warmedCalibration(BOX, measureHeroSegment),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
      ),
    );

    const disagreements: string[] = [];
    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      const predicted = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
      );
      if (predicted !== sample.lineCount) {
        disagreements.push(
          `${sample.widthPx}px predicted ${predicted}, drawn ${sample.lineCount}: ${sample.text}`,
        );
      }
    }

    console.log(
      `line counts /${HERO_ROW_HEIGHT_SAMPLES.length} — average width: ${averageLines}, measured segments: ${segmentLines}; ` +
        `mean |estimate - measured| — average width: ${averageHeight}, measured segments: ${segmentHeight}`,
    );
    if (disagreements.length > 0) {
      console.log(
        `still wrong with measured segments:\n  ${disagreements.join("\n  ")}`,
      );
    }

    // The floor this phase must not fall through: segment measurement cannot be
    // worse at line counting than a good average, which is the one quantity the
    // estimator actually models and the one that cannot cancel.
    expect(segmentLines).toBeGreaterThanOrEqual(averageLines);
  });

  test("the three defects, attributed one at a time", () => {
    // The gate, and the reason it is a grid rather than a before/after: the
    // fixes push the height in OPPOSITE directions, and a single pair of
    // numbers would let one hide inside the other.
    //
    //   - the render advance ADDS a line to rows whose last-line slack is under
    //     the badge's 59.39px, raising the estimate;
    //   - the line-height correction (21 -> 20.3, the element that lays the
    //     text out rather than the cell) LOWERS every line, and therefore every
    //     multi-line estimate;
    //   - the last line box (22.61875px, measured) raises every wrapped row by
    //     2.31875px, ONCE, whatever its line count. This is the term the 21px
    //     line height was standing in for: it is why "advance only (cell 21px)"
    //     scored better than "line height only", and why correcting the line
    //     height alone made every row under-estimate.
    //
    // Reported, not tuned. Nothing below is asserted against a target number:
    // the verdict is the plan's to draw from the printed table.
    const CELL_BOX = HERO_ROW_BOX_METRICS_CELL_LINE_HEIGHT;
    const cases = [
      { label: "before (cell 21px, no advance)", box: CELL_BOX, adv: null },
      { label: "line height only (20.3px)", box: BOX, adv: null },
      {
        label: "advance only (cell 21px)",
        box: CELL_BOX,
        adv: HERO_RENDER_ADVANCES,
      },
      {
        label: "20.3px + advance (Task 3)",
        box: BOX,
        adv: HERO_RENDER_ADVANCES,
      },
      {
        label: "after (+ last line box)",
        box: BOX,
        adv: HERO_RENDER_ADVANCES_WITH_LINE_BOX,
      },
    ] as const;

    const rows = cases.map(({ label, box, adv }) => {
      const lines = correctLineCounts(measureHeroSegment, box, adv);
      const height = mean(
        errorsFor(
          warmedCalibration(box, measureHeroSegment, adv),
          HERO_AVERAGE_CHAR_WIDTH_PX,
          box,
          measureHeroSegment,
          adv,
        ),
      );
      return { label, lines, height };
    });

    console.log(
      [
        `the three defects, one at a time (measured-segment path, ${HERO_ROW_HEIGHT_SAMPLES.length} rows):`,
        ...rows.map(
          (row) =>
            `  ${row.label.padEnd(32)} line counts ${String(row.lines).padStart(2)}/${HERO_ROW_HEIGHT_SAMPLES.length}` +
            `   mean |error| ${row.height.toFixed(4).padStart(9)}px`,
        ),
      ].join("\n"),
    );

    // The one thing that IS pinned: every row is scored, and the five
    // configurations are genuinely five configurations. If the advance, the box
    // or the line box failed to reach the estimator, some pair here would
    // coincide exactly and the table above would be a fiction.
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.height)).size).toBe(5);
  });

  test("the 12 rows that LOSE on line count are rows the estimator got RIGHT", () => {
    // Why the table above shows 48/48 -> 36/48, and why that is not the
    // regression it reads as.
    //
    // `sample.lineCount` is a `Range` over the analyst TEXT NODE: the line boxes
    // the text occupies. The estimator predicts the line boxes the CELL
    // occupies, because that is what a row's height is made of, and on this hero
    // those differ by one whenever the badge does not fit in the last line's
    // slack — the badge takes a line box of its own and the text does not follow
    // it down.
    //
    // The two are compared here against a THIRD quantity that is neither: the
    // cell's line count read back out of the measured row height. Only four
    // heights occur across the 48 samples and they step by one line of this
    // font, which is the inversion PR #370 established and cross-checked two
    // ways. If the advance were inventing lines rather than finding real ones,
    // agreement with this column would FALL.
    const RENDERED_BY_HEIGHT: Readonly<Record<number, number>> = {
      63: 1,
      68: 2,
      89: 3,
      109: 4,
    };

    let textAgreementWithout = 0;
    let textAgreementWith = 0;
    let cellAgreementWithout = 0;
    let cellAgreementWith = 0;
    let inferable = 0;

    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      const without = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
      );
      const withAdvance = predictRowLineCount(
        { analyst: sample.text },
        columnsFor(sample),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
        null,
        HERO_RENDER_ADVANCES,
      );
      if (without === sample.lineCount) textAgreementWithout += 1;
      if (withAdvance === sample.lineCount) textAgreementWith += 1;

      const rendered = RENDERED_BY_HEIGHT[sample.heightPx];
      if (rendered === undefined) continue;
      inferable += 1;
      if (without === rendered) cellAgreementWithout += 1;
      if (withAdvance === rendered) cellAgreementWith += 1;
    }

    console.log(
      [
        "what the line count is being graded against:",
        `  vs the TEXT's line boxes (sample.lineCount, a Range over the text node)` +
          `   no advance ${textAgreementWithout}/${HERO_ROW_HEIGHT_SAMPLES.length}` +
          `   with advance ${textAgreementWith}/${HERO_ROW_HEIGHT_SAMPLES.length}`,
        `  vs the CELL's line boxes (inferred from the measured row height)` +
          `        no advance ${cellAgreementWithout}/${inferable}` +
          `   with advance ${cellAgreementWith}/${inferable}`,
      ].join("\n"),
    );

    // The claim, stated so it can fail: the advance moves agreement DOWN against
    // the text's lines and UP against the cell's, and the cell's is the quantity
    // a row height is built from.
    expect(textAgreementWith).toBeLessThan(textAgreementWithout);
    expect(cellAgreementWith).toBeGreaterThan(cellAgreementWithout);
  });

  test("the advance reaches the estimator on BOTH of its paths", () => {
    // Mutation guard for the table above, in the shape this series has needed
    // twice: a dropped trailing argument prints a plausible table in which the
    // "advance" columns are copies of the no-advance ones.
    //
    // An absurd advance — wider than the whole column — must force every row to
    // more lines than it needs, on the line-count path and the height path
    // alike. Dropping `renderAdvances` from either call below fails this.
    const absurd: RenderAdvances = new Map([
      ["analyst", { widthPx: 10_000, lastLineBoxPx: null }],
    ]);
    const sample = HERO_ROW_HEIGHT_SAMPLES.find((row) => row.lineCount === 1);
    expect(sample).toBeDefined();
    if (sample === undefined) return;

    const baseLines = predictRowLineCount(
      { analyst: sample.text },
      columnsFor(sample),
      HERO_AVERAGE_CHAR_WIDTH_PX,
      BOX,
      measureHeroSegment,
    );
    const chargedLines = predictRowLineCount(
      { analyst: sample.text },
      columnsFor(sample),
      HERO_AVERAGE_CHAR_WIDTH_PX,
      BOX,
      measureHeroSegment,
      null,
      absurd,
    );
    expect(chargedLines).toBeGreaterThan(baseLines);

    const baseHeight = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      null,
      HERO_AVERAGE_CHAR_WIDTH_PX,
      BOX,
      measureHeroSegment,
    );
    const chargedHeight = estimateDomRowHeight(
      { analyst: sample.text },
      columnsFor(sample),
      THEME_ROW_HEIGHT,
      null,
      HERO_AVERAGE_CHAR_WIDTH_PX,
      BOX,
      measureHeroSegment,
      null,
      absurd,
    );
    expect(chargedHeight).toBeGreaterThan(baseHeight);
  });

  test("the last line box reaches the height path, and only the height path", () => {
    // Mutation guard for the table above, in the shape this series has needed
    // twice: a dropped field prints a plausible "after" column that is a copy
    // of the "before" one. An absurd line box must raise every wrapped row by
    // its excess over the line height, and must move no line count — the count
    // is what the floor's admission rule reads.
    const absurd: RenderAdvances = new Map([
      ["analyst", { widthPx: HERO_RENDER_ADVANCE_PX, lastLineBoxPx: 1_000 }],
    ]);
    const excess = 1_000 - HERO_ROW_BOX_METRICS.lineHeightPx;

    // `baseHeight` 0, so the theme's 48px floor cannot clamp a short row and
    // hide the difference: what is being asserted is the text-driven height.
    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      const base = estimateDomRowHeight(
        { analyst: sample.text },
        columnsFor(sample),
        0,
        null,
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
        null,
        HERO_RENDER_ADVANCES,
      );
      const charged = estimateDomRowHeight(
        { analyst: sample.text },
        columnsFor(sample),
        0,
        null,
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        measureHeroSegment,
        null,
        absurd,
      );
      expect(charged).toBeCloseTo(base + excess, 6);
      expect(
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
          BOX,
          measureHeroSegment,
          null,
          absurd,
        ),
      ).toBe(
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
          BOX,
          measureHeroSegment,
          null,
          HERO_RENDER_ADVANCES,
        ),
      );
    }
  });

  test("the measured path is the one being exercised, not a silent fallback", () => {
    // Mutation guard for the test above. If the measurer never reached
    // `prepareText` — a dropped argument, a renamed field — every number there
    // would still print, identical to the average path, and the comparison
    // would be vacuous. A measurer that reports every token as one pixel wide
    // cannot wrap anything, so a 3-line sample must collapse to 1.
    const wide = HERO_ROW_HEIGHT_SAMPLES.find(
      (sample) => sample.lineCount >= 3,
    );
    expect(wide).toBeDefined();
    if (wide === undefined) return;
    expect(
      predictRowLineCount(
        { analyst: wide.text },
        columnsFor(wide),
        HERO_AVERAGE_CHAR_WIDTH_PX,
        BOX,
        () => 1,
      ),
    ).toBe(1);
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

/**
 * The whitespace model, on rows chosen to be able to show it wrong.
 *
 * `HERO_ROW_HEIGHT_SAMPLES` cannot: it holds no whitespace run, no tab and no
 * newline, so it scores the same under either model and would report a clean
 * pass whatever the estimator does with whitespace. `HERO_WHITESPACE_SAMPLES`
 * is the instrument that can fail, and it was captured before anything was
 * fixed.
 *
 * Every number here is reported on the extended array ALONE. The 48-row figures
 * above stay exactly comparable to every earlier PR in this series.
 */
describe("the whitespace model the browser actually runs", () => {
  const WHITESPACE_BOX = HERO_ROW_BOX_METRICS;

  function whitespaceColumns(sample: RowHeightSample) {
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
   * The two boxes the whole block compares.
   *
   * `UNRESOLVED` carries no wrap mode, which is exactly what a grid that could
   * not read one hands over — and what BOTH estimator paths hardcoded before
   * this change. `RESOLVED` carries the `pre-wrap` the hero's cells were
   * measured at. Every figure below is one or the other; nothing here toggles
   * a flag the estimator does not really read.
   */
  const UNRESOLVED = WHITESPACE_BOX;
  const RESOLVED = { ...WHITESPACE_BOX, wrapMode: HERO_WRAP_MODE };

  function predict(
    sample: RowHeightSample,
    box: typeof UNRESOLVED = RESOLVED,
  ): number {
    return predictRowLineCount(
      { analyst: sample.text },
      whitespaceColumns(sample),
      HERO_AVERAGE_CHAR_WIDTH_PX,
      box,
      measureHeroSegment,
    );
  }

  function score(box: typeof UNRESOLVED): {
    correct: number;
    meanError: number;
    separated: number;
    separatedSpaces: number;
    spacePairs: number;
    wrong: string[];
  } {
    let correct = 0;
    let totalError = 0;
    const wrong: string[] = [];
    for (const sample of HERO_WHITESPACE_SAMPLES) {
      const predicted = predict(sample, box);
      if (predicted === sample.lineCount) correct += 1;
      else
        wrong.push(
          `${sample.widthPx}px predicted ${predicted}, drawn ${sample.lineCount}: ${JSON.stringify(sample.text)}`,
        );
      totalError += Math.abs(
        estimateDomRowHeight(
          { analyst: sample.text },
          whitespaceColumns(sample),
          0,
          null,
          HERO_AVERAGE_CHAR_WIDTH_PX,
          box,
          measureHeroSegment,
        ) - sample.heightPx,
      );
    }

    let separated = 0;
    let separatedSpaces = 0;
    let spacePairs = 0;
    for (
      let index = 0;
      index + 1 < HERO_WHITESPACE_SAMPLES.length;
      index += 2
    ) {
      const shorter = HERO_WHITESPACE_SAMPLES[index];
      const longer = HERO_WHITESPACE_SAMPLES[index + 1];
      if (shorter === undefined || longer === undefined) continue;
      const isTabPair = longer.text.includes("\t");
      if (!isTabPair) spacePairs += 1;
      if (predict(shorter, box) !== predict(longer, box)) {
        separated += 1;
        if (!isTabPair) separatedSpaces += 1;
      }
    }

    return {
      correct,
      meanError: totalError / HERO_WHITESPACE_SAMPLES.length,
      separated,
      separatedSpaces,
      spacePairs,
      wrong,
    };
  }

  test("the extended fixture actually contains whitespace to be wrong about", () => {
    // The gate on the instrument, not on the estimator. A fixture of ordinary
    // prose grades a whitespace fix vacuously, which is the failure this whole
    // block exists to prevent — so the properties it needs are asserted rather
    // than assumed from a glance at the array.
    const has = (pattern: RegExp) =>
      HERO_WHITESPACE_SAMPLES.filter((sample) => pattern.test(sample.text))
        .length;

    expect(HERO_WHITESPACE_SAMPLES.length).toBeGreaterThanOrEqual(20);
    // A run of two or more spaces somewhere other than the start.
    expect(has(/\S {2,}/u)).toBeGreaterThanOrEqual(4);
    // Leading whitespace.
    expect(has(/^[^\S\n]/u)).toBeGreaterThanOrEqual(2);
    // A tab.
    expect(has(/\t/u)).toBeGreaterThanOrEqual(2);
    // An explicit newline.
    expect(has(/\n/u)).toBeGreaterThanOrEqual(2);
    // And none of it leaked into the 48 rows, which must stay prose.
    expect(
      HERO_ROW_HEIGHT_SAMPLES.filter((sample) =>
        /\s\s|\t|\n/u.test(sample.text),
      ),
    ).toHaveLength(0);
  });

  test("each pair differs by one whitespace character and one drawn line box", () => {
    // The fixture's own claim, checked against the fixture rather than trusted
    // from its doc comment. Pairs are consecutive, and a pair whose members
    // differ anywhere but in one whitespace character would make every
    // conclusion below unsound.
    let pairs = 0;
    for (
      let index = 0;
      index + 1 < HERO_WHITESPACE_SAMPLES.length;
      index += 2
    ) {
      const shorter = HERO_WHITESPACE_SAMPLES[index];
      const longer = HERO_WHITESPACE_SAMPLES[index + 1];
      if (shorter === undefined || longer === undefined) continue;
      expect(longer.widthPx).toBe(shorter.widthPx);
      expect(longer.text.length).toBe(shorter.text.length + 1);
      // Same string once the whitespace runs are collapsed away — which is
      // precisely what `wrapMode: "wrap"` believes about them.
      expect(collapse(longer.text)).toBe(collapse(shorter.text));
      // And the browser drew them one line box apart anyway.
      expect(longer.lineCount).toBe(shorter.lineCount + 1);
      pairs += 1;
    }
    expect(pairs).toBe(10);
  });

  test("heightPx is the cell height these line counts imply, to the pixel", () => {
    // Guards the capture: `heightPx` here is a clone's own border box, so it is
    // `lines × line box + padding + rule` exactly. A sample whose height and
    // line count disagree was edited rather than measured.
    for (const sample of HERO_WHITESPACE_SAMPLES) {
      expect(sample.heightPx).toBeCloseTo(sample.lineCount * 20.296875 + 25, 6);
    }
  });

  test("GATE: resolving the wrap mode separates pairs the collapse cannot", () => {
    // The defect and the fix, as one number that has to move.
    //
    // Both estimator paths used to hardcode `text-core`'s `wrap` for exactly
    // the columns `pretable-surface.tsx` renders as `white-space: pre-wrap`.
    // Under `wrap` a run of whitespace collapses to one grapheme and a run at
    // the start of a line disappears entirely, so the two members of every pair
    // below are the SAME STRING to the estimator: it is not merely likely to
    // predict the same line count for both, it is unable to do otherwise. The
    // browser drew them one line apart.
    //
    // That makes it a structural claim rather than a tuned threshold, in one
    // direction: with no wrap mode resolved the estimator must separate ZERO
    // pairs, because it cannot see the difference at all.
    //
    // In the other direction the claim is scoped to the SPACE and NEWLINE
    // pairs, and the scoping is the honest part. Resolving `pre-wrap` charges
    // a preserved run its measured width, and for a space run that width is
    // right. For a TAB it is not: CSS advances a tab to the next `tab-size`
    // stop — a function of where the pen already sits — while
    // `canvas.measureText("\t")` reports a flat one-space 3.787px whatever
    // precedes it. So the three tab pairs stay collapsed after the fix, and
    // pinning them at zero here records that as a known remaining gap rather
    // than letting a future tab-stop model silently not happen.
    const before = score(UNRESOLVED);
    const after = score(RESOLVED);
    const tabPairs = 10 - after.spacePairs;

    console.log(
      `whitespace pairs separated — unresolved ${before.separated}/10, resolved pre-wrap ${after.separated}/10 ` +
        `(space and newline ${after.separatedSpaces}/${after.spacePairs}, tab ${after.separated - after.separatedSpaces}/${tabPairs})`,
    );

    expect(before.separated).toBe(0);
    expect(after.spacePairs).toBe(7);
    expect(after.separatedSpaces).toBe(7);
    // The tab gap, pinned. Not an aspiration — a measurement of what a flat
    // tab advance can and cannot do.
    expect(after.separated - after.separatedSpaces).toBe(0);
  });

  test("extended rows: line counts and height error, before and after", () => {
    // The accuracy figures for the extended array ALONE, so the 48-row numbers
    // above stay quotable against every earlier PR in this series.
    //
    // The rows that remain wrong after the fix are the tab samples, and they
    // are wrong for a reason the wrap mode does not reach: CSS advances a tab
    // to the next `tab-size` stop, which depends on where the pen already sits,
    // while `canvas.measureText("\t")` reports a flat one-space 3.787px. A tab
    // run is under-charged under either model. `pre-wrap` charges the whole run
    // rather than collapsing it away, which is nearer, and the residual is
    // named here rather than hidden by dropping the case from the fixture.
    const before = score(UNRESOLVED);
    const after = score(RESOLVED);
    const total = HERO_WHITESPACE_SAMPLES.length;

    console.log(
      [
        `extended rows (${total}), unresolved -> resolved pre-wrap:`,
        `  line counts   ${before.correct}/${total} -> ${after.correct}/${total}`,
        `  mean |error|  ${before.meanError.toFixed(4)}px -> ${after.meanError.toFixed(4)}px`,
        after.wrong.length > 0
          ? `  still wrong:\n    ${after.wrong.join("\n    ")}`
          : "  nothing still wrong",
      ].join("\n"),
    );

    expect(after.correct).toBeGreaterThan(before.correct);
    expect(after.meanError).toBeLessThan(before.meanError);
    // Every sample that is still wrong is a tab sample. If a space or newline
    // sample ever joins them, this fails rather than blending into a mean.
    for (const line of after.wrong) {
      expect(line, `not a tab sample: ${line}`).toContain("\\t");
    }
  });

  test("the 48 prose rows cannot tell the two models apart", () => {
    // Why the fixture had to be extended at all, asserted rather than asserted
    // about. Resolving the wrap mode must move NOTHING on the original rows:
    // they contain no run, no tab and no leading whitespace, so `wrap` and
    // `pre-wrap` are the same function on them. This is simultaneously the
    // proof that the 48-row figures above stay comparable, and the proof that
    // an instrument built only from them could not have graded this change.
    for (const sample of HERO_ROW_HEIGHT_SAMPLES) {
      const columns = columnsFor(sample);
      expect(
        predictRowLineCount(
          { analyst: sample.text },
          columns,
          HERO_AVERAGE_CHAR_WIDTH_PX,
          { ...BOX, wrapMode: HERO_WRAP_MODE },
          measureHeroSegment,
        ),
      ).toBe(
        predictRowLineCount(
          { analyst: sample.text },
          columns,
          HERO_AVERAGE_CHAR_WIDTH_PX,
          BOX,
          measureHeroSegment,
        ),
      );
    }
  });

  test("an unresolved box keeps exactly the behaviour that shipped before", () => {
    // The safety property, on the samples most able to violate it. A box with
    // no `wrapMode` must produce the identical line count to one that names
    // `"wrap"` explicitly — the estimator's default is that model and not, say,
    // a silent `undefined` reaching `text-core` as something else.
    for (const sample of HERO_WHITESPACE_SAMPLES) {
      expect(predict(sample, UNRESOLVED)).toBe(
        predict(sample, { ...UNRESOLVED, wrapMode: "wrap" }),
      );
    }
  });
});

/** The `white-space: normal` collapse, for comparing two samples as `wrap` sees them. */
function collapse(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replaceAll(/[^\S\n]+/gu, " ").replace(/^ /u, ""))
    .join("\n");
}
