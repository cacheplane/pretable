import { describe, expect, test } from "vitest";

import { createRowHeightCalibration } from "../row-height-calibration";

/**
 * The row box is read from CSS, not learned. What is left here is the single
 * term no stylesheet describes: the floor a custom `render` prop imposes on
 * rows whose wrapped text does not decide their height.
 *
 *   floor = max over rows the estimator predicts at 0 or 1 lines
 *
 * At one line the wrapped cell often is not the tallest cell in the row — a
 * custom two-line renderer can be — so those rows say nothing about text
 * arithmetic and everything about the floor.
 */
describe("row height calibration", () => {
  test("reports nothing until a row the text cannot decide is measured", () => {
    const calibration = createRowHeightCalibration();
    expect(calibration.getParameters()).toBeNull();

    // Wrapped rows are decided by the CSS box, so they teach this nothing.
    calibration.observe(2, 68);
    expect(calibration.getParameters()).toBeNull();
  });

  test("learns the floor from rows whose wrapped text does not decide them", () => {
    const calibration = createRowHeightCalibration();
    calibration.observe(1, 63);
    calibration.observe(0, 63);
    calibration.observe(1, 61);

    // A max, not a mean: the floor must cover the tallest such row, or the
    // first-paint shrink this exists to remove comes back.
    expect(calibration.getParameters()?.floorPx).toBe(63);
  });

  test("ignores measurements that cannot be a height", () => {
    // The floor is a running max, so a torn read from a detached or unpainted
    // row would be kept forever.
    const calibration = createRowHeightCalibration();
    calibration.observe(1, Number.NaN);
    calibration.observe(Number.NaN, 500);
    calibration.observe(1, 0);
    calibration.observe(1, -10);
    expect(calibration.getParameters()).toBeNull();

    calibration.observe(1, 63);
    calibration.observe(1, Number.POSITIVE_INFINITY);
    expect(calibration.getParameters()?.floorPx).toBe(63);
  });

  test("returns a stable object identity until the floor changes", () => {
    const calibration = createRowHeightCalibration();
    calibration.observe(1, 63);

    const first = calibration.getParameters();
    expect(calibration.getParameters()).toBe(first);

    // A shorter row cannot lower a max, so the identity must not churn —
    // consumers memoize their estimates on it.
    calibration.observe(1, 40);
    expect(calibration.getParameters()).toBe(first);

    // A taller one must.
    calibration.observe(1, 70);
    const second = calibration.getParameters();
    expect(second).not.toBe(first);
    expect(second?.floorPx).toBe(70);
  });
});
