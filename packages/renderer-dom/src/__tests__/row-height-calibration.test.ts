import { describe, expect, test } from "vitest";

import { createRowHeightCalibration } from "../row-height-calibration";

/**
 * The row box is read from CSS, not learned. What is left here is the single
 * term no stylesheet describes: the floor a custom `render` prop imposes on
 * rows whose wrapped text does not decide their height.
 *
 *   floor = mean over rows the estimator predicts at 0 or 1 lines
 *
 * At one line the wrapped cell often is not the tallest cell in the row — a
 * custom two-line renderer can be — so those rows say nothing about text
 * arithmetic and everything about the floor.
 *
 * A mean rather than the running max this shipped with for most of its life.
 * The max was upheld twice on a cancellation — it was biased high, and the
 * estimator was biased low by more — and #373 removed the low bias. Measured on
 * top of that, the mean wins both the per-row error and the scroll extent on
 * the average (no-canvas / SSR) path and ties on the measured one. The numbers
 * are in `row-height-calibration.ts`; the instrument is `row-height-bias.test.ts`.
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
    calibration.observe(1, 60);

    // A mean, not a max: 62, not 63. The two policies are the same number for
    // any run of equal measurements, so this row set is deliberately unequal —
    // otherwise the assertion would hold under either policy and pin nothing.
    expect(calibration.getParameters()?.floorPx).toBe(62);
  });

  test("does not let a two-line row into the mean", () => {
    // Rows the text decides are excluded from the floor, and under a mean an
    // excluded row does not merely fail to raise the answer — it must not move
    // it at all. A 68px wrapped row averaged in would read 65.5, not 63.
    const calibration = createRowHeightCalibration();
    calibration.observe(1, 63);
    calibration.observe(2, 68);
    expect(calibration.getParameters()?.floorPx).toBe(63);
  });

  test("ignores measurements that cannot be a height", () => {
    // A torn read from a detached or unpainted row. Under a mean an infinity
    // is worse than under the max it replaced: it makes every later answer NaN
    // rather than merely pinning one too-tall floor.
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

    // A row at the current mean does not move it, so the identity must not
    // churn — consumers memoize their estimates on it.
    calibration.observe(1, 63);
    expect(calibration.getParameters()).toBe(first);

    // One that moves it must. A max would have ignored this shorter row
    // entirely and kept `first`.
    calibration.observe(1, 60);
    const second = calibration.getParameters();
    expect(second).not.toBe(first);
    expect(second?.floorPx).toBe(62);
  });
});
