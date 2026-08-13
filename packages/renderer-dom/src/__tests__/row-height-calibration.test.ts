import { describe, expect, test } from "vitest";

import { createRowHeightCalibration } from "../row-height-calibration";

/**
 * The estimator's constants are calibrated for one app's font. This module
 * learns the real ones from measurements the grid already takes, so the model
 * being fitted is the one the DOM actually produces:
 *
 *   measured ≈ max(floor, chrome + lines × lineHeight)
 *
 * The hinge matters. At one line the wrapped cell often is not the tallest cell
 * in the row — a custom two-line renderer can be — so those rows say nothing
 * about line height and everything about the floor. They are fitted separately.
 */
describe("row height calibration", () => {
  test("reports nothing until it has seen enough", () => {
    const calibration = createRowHeightCalibration();
    expect(calibration.getParameters()).toBeNull();

    // One wrapped sample cannot separate slope from intercept.
    calibration.observe(2, 68);
    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("recovers line height and chrome from wrapped rows", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 4 });
    // The hero's real numbers: chrome 25, line height 21.07.
    for (const [lines, height] of [
      [2, 67.14],
      [3, 88.21],
      [2, 67.14],
      [4, 109.28],
    ] as const) {
      calibration.observe(lines, height);
    }

    const parameters = calibration.getParameters();
    expect(parameters?.lineHeightPx).toBeCloseTo(21.07, 1);
    expect(parameters?.chromePx).toBeCloseTo(25, 1);
  });

  test("learns the floor from rows whose wrapped text does not decide them", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 4 });
    calibration.observe(1, 63);
    calibration.observe(0, 63);
    calibration.observe(1, 61);

    // Floor is available even with no wrapped samples at all — those rows are
    // exactly the ones a custom renderer decides.
    expect(calibration.getParameters()?.floorPx).toBe(63);
  });

  test("refuses a degenerate fit rather than propagating it", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 3 });
    // Every sample at the same line count: the slope is unidentifiable.
    calibration.observe(2, 68);
    calibration.observe(2, 68);
    calibration.observe(2, 68);

    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("rejects an implausible fit", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 3 });
    // A negative slope is not a line height under any font.
    calibration.observe(2, 90);
    calibration.observe(3, 60);
    calibration.observe(4, 30);

    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("forgets old samples so a grid that changes content re-converges", () => {
    const calibration = createRowHeightCalibration({
      minWrappedSamples: 2,
      sampleCapacity: 4,
    });
    for (const [lines, height] of [
      [2, 100],
      [3, 150],
    ] as const) {
      calibration.observe(lines, height);
    }
    expect(calibration.getParameters()?.lineHeightPx).toBeCloseTo(50, 1);

    // Four new samples at a different scale evict the originals entirely.
    for (const [lines, height] of [
      [2, 40],
      [3, 60],
      [2, 40],
      [3, 60],
    ] as const) {
      calibration.observe(lines, height);
    }
    expect(calibration.getParameters()?.lineHeightPx).toBeCloseTo(20, 1);
  });

  test("returns a stable object identity until the fit changes", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 2 });
    calibration.observe(2, 67.14);
    calibration.observe(3, 88.21);

    const first = calibration.getParameters();
    expect(calibration.getParameters()).toBe(first);

    calibration.observe(4, 109.28);
    // Same fit, so the identity must not churn — consumers memoize on it.
    expect(calibration.getParameters()).toBe(first);
  });
});
