/**
 * Learns the one thing about a row that nothing can simply read.
 *
 * The row box is not inferred any more. Line height, padding and border come
 * from CSS — `getThemeBoxMetrics()` in `packages/react` reads them off a
 * rendered cell and threads them to the estimator as `RowBoxMetrics`. This
 * module used to fit "line height" and "chrome" by least squares over measured
 * rows, and that fit was not merely redundant, it was harmful: it was
 * unidentifiable whenever the sampled rows shared a line count, its degenerate
 * solution learned a 7px "line height" that was no font metric at all, and,
 * worst, it absorbed the estimator's padding error and hid it. A wrap width
 * that ignored cell padding and a 7px-per-character guess over-stated by
 * roughly the same factor for years; the fit soaked up the residue, which is
 * why measuring the character width honestly first looked like a regression.
 * It is gone.
 *
 * What remains is the term that no stylesheet describes:
 *
 *   floor = mean over rows whose wrapped text does not decide their height
 *
 * A row whose predicted line count is 0 or 1 is frequently not decided by its
 * wrapped cell at all — a custom `render` prop drawing two lines can be the
 * tallest cell in the row, and the estimator is structurally blind to `render`
 * and `format`. No CSS token states what that renderer costs. A measurement
 * does. So those rows are accumulated, and the estimator answers such rows from
 * the floor rather than from text arithmetic.
 *
 * ## Why a mean, and why only now
 *
 * It was a running max for most of this module's life, on the argument that a
 * floor must cover the tallest row text does not decide. That argument was
 * re-examined twice and upheld twice — but both times the answer rested on a
 * cancellation rather than on the max being right. The estimator was
 * systematically UNDER-estimating (43 of 48 sampled rows short, none long), and
 * a floor biased high by construction was offsetting it. The instrument that
 * settled it, `__tests__/row-height-bias.test.ts`, said so in as many words:
 * "when the per-line shortfall is fixed, this file must be re-run — the max's
 * positive bias will stop being hidden, and the answer can flip."
 *
 * #373 fixed the shortfall (line height from the element that lays out the
 * text, the render advance charged to the last word, and the last line box). Re-
 * run on top of it, over the hero's 48 rows:
 *
 *                          max floor        mean floor
 *   measured path
 *     floor                63.0000px        63.0000px
 *     mean |error| / row    0.2876px         0.2876px
 *     relative extent      -0.3724%         -0.3724%
 *   average path (no canvas / SSR)
 *     floor                68.0000px        64.2500px
 *     mean |error| / row    3.0245px         2.2737px
 *     relative extent      +2.2481%         +0.9947%
 *
 * On the measured path the two policies are indistinguishable — every admitted
 * row measures the same 63px, so max and mean are the same number and the
 * choice is moot. On the average path the mean now wins BOTH objectives at
 * once: 0.75px per row of accuracy and 1.25 percentage points of scroll extent.
 * It previously lost both. That path is not hypothetical — it is what SSR and
 * every canvas-less host estimate through.
 *
 * The cost of the change is memo churn, and it is real: a max stops moving once
 * the tallest admitted row has been seen, while a mean shifts on every admitted
 * measurement, and consumers key their estimate memo on this object's IDENTITY.
 * Priced against an average path that under-states its scroll extent by a
 * percentage point more, and taken.
 *
 * Both numbers above are from ONE grid. The DIRECTION generalises — a running
 * max can only sit at or above the rows that fed it — but the magnitude does
 * not; it depends entirely on a grid's mix of wrapped and unwrapped rows.
 */

/** Learned metrics. A field is null when nothing has identified it yet. */
export interface RowHeightCalibrationParameters {
  readonly floorPx: number | null;
}

export interface RowHeightCalibration {
  /**
   * Record one measurement. `lineCount` is the estimator's predicted line count
   * for the row, NOT the number of lines the DOM actually produced — the whole
   * point is to correct the estimator's own prediction against reality.
   */
  observe(lineCount: number, measuredHeight: number): void;
  /** Null until anything at all has been identified. */
  getParameters(): RowHeightCalibrationParameters | null;
}

export function createRowHeightCalibration(): RowHeightCalibration {
  // Sum and count rather than an incrementally updated mean: the mean is then
  // one division of two exactly-accumulated numbers, instead of a value that
  // accretes rounding error across a scroll session.
  let totalPx = 0;
  let count = 0;
  let dirty = false;
  let cached: RowHeightCalibrationParameters | null = null;

  return {
    observe(lineCount, measuredHeight) {
      // Bounds what may enter the floor. A non-finite or non-positive
      // measurement is a torn read from a detached or unpainted row; an
      // infinity would make the mean NaN for the rest of the session, and a
      // zero would drag it down for good.
      if (!Number.isFinite(lineCount) || !Number.isFinite(measuredHeight)) {
        return;
      }
      if (measuredHeight <= 0) return;

      // Rows of two lines or more are decided by their wrapped text, which the
      // estimator computes from the CSS box. They teach this module nothing.
      if (lineCount >= 2) return;

      totalPx += measuredHeight;
      count += 1;
      dirty = true;
    },
    getParameters() {
      if (!dirty) return cached;
      dirty = false;
      // Identity is part of the contract: consumers memoize their estimates on
      // it, so an unchanged floor must not produce a new object. A mean moves
      // more often than the max did — see the module comment — but a run of
      // identical measurements still costs no churn at all.
      if (count === 0) return cached;
      const floorPx = totalPx / count;
      if (cached !== null && cached.floorPx === floorPx) return cached;
      cached = Object.freeze({ floorPx });
      return cached;
    },
  };
}
