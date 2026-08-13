/**
 * Learns what a row actually costs, from the measurements the grid already takes.
 *
 * `estimateDomRowHeight`'s constants are calibrated against the bench app's font
 * (Inter Variable at 16px). Any other consumer gets a systematically wrong
 * answer — the homepage hero measures a 21.07px line box and 25px of chrome
 * against constants of 24 and 42 — and the error is always in the same
 * direction, so a row visibly shrinks the moment it is first measured.
 *
 * The model:
 *
 *   measured ≈ max(floor, chrome + lines × lineHeight)
 *
 * The hinge is not a convenience. At one line the wrapped cell is frequently not
 * the tallest cell in its row: a custom two-line renderer can be, and the
 * estimator is structurally blind to `render` and `format`. So rows whose
 * predicted line count is 0 or 1 say nothing about line height and everything
 * about the floor, and are fitted separately. That floor term is how this also
 * covers content the estimator cannot read.
 *
 * Deliberately NOT learned: `ESTIMATED_CHARACTER_WIDTH`. It determines the line
 * count itself, and separating it from the other parameters needs to know where
 * wrap points actually fall, which a height measurement does not say. Residual
 * error therefore remains wherever the predicted line count is simply wrong.
 */

/** Learned metrics. A field is null when the data cannot identify it. */
export interface RowHeightCalibrationParameters {
  readonly lineHeightPx: number | null;
  readonly chromePx: number | null;
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

export interface RowHeightCalibrationOptions {
  /** Wrapped samples required before a fit is attempted. */
  readonly minWrappedSamples?: number;
  /** Ring-buffer size for wrapped samples. */
  readonly sampleCapacity?: number;
}

const DEFAULT_MIN_WRAPPED_SAMPLES = 4;
const DEFAULT_SAMPLE_CAPACITY = 64;
/**
 * Sanity bounds. A fit outside these is not a font metric, it is noise or a
 * grid whose rows are not sized by text at all, and propagating it would be
 * worse than the constants it replaces.
 */
const MIN_PLAUSIBLE_LINE_HEIGHT = 4;
const MAX_PLAUSIBLE_LINE_HEIGHT = 400;
const MAX_PLAUSIBLE_CHROME = 400;

interface WrappedSample {
  readonly lineCount: number;
  readonly measuredHeight: number;
}

export function createRowHeightCalibration(
  options: RowHeightCalibrationOptions = {},
): RowHeightCalibration {
  const minWrappedSamples =
    options.minWrappedSamples ?? DEFAULT_MIN_WRAPPED_SAMPLES;
  const sampleCapacity = options.sampleCapacity ?? DEFAULT_SAMPLE_CAPACITY;

  const wrapped: WrappedSample[] = [];
  let floorPx: number | null = null;
  let dirty = false;
  let cached: RowHeightCalibrationParameters | null = null;

  const fitWrapped = (): { lineHeightPx: number; chromePx: number } | null => {
    if (wrapped.length < minWrappedSamples) return null;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const sample of wrapped) {
      sumX += sample.lineCount;
      sumY += sample.measuredHeight;
      sumXY += sample.lineCount * sample.measuredHeight;
      sumXX += sample.lineCount * sample.lineCount;
    }
    const n = wrapped.length;
    const denominator = n * sumXX - sumX * sumX;
    // Zero denominator means every sample sits at the same line count, so slope
    // and intercept cannot be separated. That is the common early case, not an
    // error — it just means we do not know yet.
    if (denominator === 0) return null;

    // Rounded to 1/100px before anything else sees them. Two reasons, both
    // load-bearing: a fit over points that lie exactly on a line still comes
    // back with float noise in the last bits, and consumers memoize on this
    // object's identity — so unrounded values would mint a new object on every
    // sample and defeat the memo the estimator depends on.
    const round = (value: number) => Math.round(value * 100) / 100;
    const lineHeightPx = round((n * sumXY - sumX * sumY) / denominator);
    const chromePx = round((sumY - lineHeightPx * sumX) / n);

    if (
      !Number.isFinite(lineHeightPx) ||
      !Number.isFinite(chromePx) ||
      lineHeightPx < MIN_PLAUSIBLE_LINE_HEIGHT ||
      lineHeightPx > MAX_PLAUSIBLE_LINE_HEIGHT ||
      chromePx < 0 ||
      chromePx > MAX_PLAUSIBLE_CHROME
    ) {
      return null;
    }

    return { lineHeightPx, chromePx };
  };

  const recompute = (): RowHeightCalibrationParameters | null => {
    const fit = fitWrapped();
    if (fit === null && floorPx === null) return null;
    return Object.freeze({
      lineHeightPx: fit?.lineHeightPx ?? null,
      chromePx: fit?.chromePx ?? null,
      floorPx,
    });
  };

  const sameParameters = (
    left: RowHeightCalibrationParameters | null,
    right: RowHeightCalibrationParameters | null,
  ): boolean => {
    if (left === null || right === null) return left === right;
    return (
      left.lineHeightPx === right.lineHeightPx &&
      left.chromePx === right.chromePx &&
      left.floorPx === right.floorPx
    );
  };

  return {
    observe(lineCount, measuredHeight) {
      if (!Number.isFinite(lineCount) || !Number.isFinite(measuredHeight)) {
        return;
      }
      if (measuredHeight <= 0) return;

      if (lineCount >= 2) {
        wrapped.push({ lineCount, measuredHeight });
        // Bounded, so a grid whose content class changes re-converges instead of
        // averaging over its entire history.
        while (wrapped.length > sampleCapacity) wrapped.shift();
      } else {
        // A floor must cover the tallest row that text does not decide, so this
        // is a max rather than a mean: under-estimating here reintroduces the
        // first-paint shrink this exists to remove.
        floorPx =
          floorPx === null ? measuredHeight : Math.max(floorPx, measuredHeight);
      }
      dirty = true;
    },
    getParameters() {
      if (!dirty) return cached;
      dirty = false;
      const next = recompute();
      // Identity is part of the contract: consumers memoize their estimates on
      // it, so an unchanged fit must not produce a new object.
      if (!sameParameters(cached, next)) cached = next;
      return cached;
    },
  };
}
