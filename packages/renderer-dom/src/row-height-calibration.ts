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
 *   floor = max over rows whose wrapped text does not decide their height
 *
 * A row whose predicted line count is 0 or 1 is frequently not decided by its
 * wrapped cell at all — a custom `render` prop drawing two lines can be the
 * tallest cell in the row, and the estimator is structurally blind to `render`
 * and `format`. No CSS token states what that renderer costs. A measurement
 * does. So those rows are accumulated into a running max, and the estimator
 * answers such rows from the floor rather than from text arithmetic.
 *
 * It is a max rather than a mean deliberately: a floor must cover the tallest
 * row that text does not decide, and under-estimating here reintroduces the
 * visible first-paint shrink this exists to remove.
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
  let floorPx: number | null = null;
  let dirty = false;
  let cached: RowHeightCalibrationParameters | null = null;

  return {
    observe(lineCount, measuredHeight) {
      // Bounds what may enter the floor. A non-finite or non-positive
      // measurement is a torn read from a detached or unpainted row, and a
      // running max would keep it forever.
      if (!Number.isFinite(lineCount) || !Number.isFinite(measuredHeight)) {
        return;
      }
      if (measuredHeight <= 0) return;

      // Rows of two lines or more are decided by their wrapped text, which the
      // estimator computes from the CSS box. They teach this module nothing.
      if (lineCount >= 2) return;

      floorPx =
        floorPx === null ? measuredHeight : Math.max(floorPx, measuredHeight);
      dirty = true;
    },
    getParameters() {
      if (!dirty) return cached;
      dirty = false;
      // Identity is part of the contract: consumers memoize their estimates on
      // it, so an unchanged floor must not produce a new object.
      if (floorPx === null) return cached;
      if (cached !== null && cached.floorPx === floorPx) return cached;
      cached = Object.freeze({ floorPx });
      return cached;
    },
  };
}
