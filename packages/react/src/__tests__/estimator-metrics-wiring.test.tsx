// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";

import type { RowBoxMetrics } from "@pretable-internal/renderer-dom";

/**
 * The four lines in `pretable-model.ts` that hand the row layout controller its
 * measured text metrics, pinned.
 *
 * `createRowLayoutController` is constructed with `getAverageCharWidthPx`,
 * `getRowBoxMetrics`, `getSegmentMeasurer` and `getLetterSpacingPx`. Every one
 * of those options is optional on the controller, so deleting any of the four
 * lines type-checks, lints, and — before this file — broke no test in the repo.
 * The estimator silently reverted to the pre-measurement constants and every
 * suite stayed green. Three phases of this series shipped through that gap.
 *
 * ## Why it is asserted here rather than through a rendered row
 *
 * The obvious test — render a grid, change a metric, watch a row height move —
 * cannot be written in jsdom, and it is worth recording why rather than leaving
 * the next person to rediscover it:
 *
 *  - The real getters cannot answer. `text-metrics.ts` asks for a 2d canvas
 *    context first and returns null when there is none, and jsdom has none. So
 *    they are mocked at their module boundary below.
 *  - Even mocked, the effect is unobservable. Only rows inside the planned
 *    viewport are estimated at all; every row beyond it carries the controller's
 *    `defaultRowHeight`, so the scroll extent is `rowCount × defaultRowHeight`
 *    and is blind to content. And the handful of rows that ARE estimated are
 *    measured by the DOM within a frame — at zero, in jsdom, floored back to the
 *    theme height. Both paths erase exactly the quantity under test. Measured
 *    directly, all four configurations produce an identical 17600px extent.
 *
 * So this asserts one seam closer: `createRowLayoutController` is wrapped, the
 * options object the model builds is captured, and each getter is invoked
 * through it. Deleting a wiring line leaves that option `undefined` and turns
 * the corresponding test red. All four were deleted in turn to check that.
 *
 * The other half of the chain — that the CONTROLLER actually consults these
 * options per estimate rather than ignoring them — is pinned separately, in
 * `renderer-dom`'s `indexed-renderer.test.ts`. Neither file is sufficient
 * alone; together they cover the whole path from a canvas measurement to a
 * wrapped row.
 */

const averageCharWidth = vi.fn<() => number | null>(() => null);
const letterSpacing = vi.fn<() => number | null>(() => null);
const segmentMeasurer = vi.fn<() => ((segment: string) => number) | null>(
  () => null,
);
const rowBoxMetrics = vi.fn<() => RowBoxMetrics | null>(() => null);

vi.mock("../text-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text-metrics")>()),
  getGridAverageCharWidth: () => averageCharWidth(),
  getGridLetterSpacingPx: () => letterSpacing(),
  getGridSegmentMeasurer: () => segmentMeasurer(),
}));

vi.mock("../density", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../density")>()),
  getGridRowBoxMetrics: () => rowBoxMetrics(),
}));

/**
 * The captured constructor options, one entry per controller the model builds.
 * The real controller is still constructed and still drives the render, so this
 * observes the production path rather than replacing it.
 */
type ControllerOptions = Parameters<
  typeof import("@pretable-internal/renderer-dom").createRowLayoutController
>[0];

const controllerOptions: ControllerOptions[] = [];

vi.mock("@pretable-internal/renderer-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pretable-internal/renderer-dom")>();
  return {
    ...actual,
    createRowLayoutController: (options: ControllerOptions) => {
      controllerOptions.push(options);
      return actual.createRowLayoutController(options as never);
    },
  };
});

const { PretableSurface } = await import("../pretable-surface");

type Row = { id: number; message: string };

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("message", { type: "text", wrap: true, widthPx: 320 }),
] as const;

const rows: readonly Row[] = [
  { id: 1, message: "Position now 8.4% of book, above the single-name limit." },
  { id: 2, message: "Drawdown sits inside the band we agreed on Tuesday." },
];

beforeEach(() => {
  controllerOptions.length = 0;
  averageCharWidth.mockReturnValue(null);
  letterSpacing.mockReturnValue(null);
  segmentMeasurer.mockReturnValue(null);
  rowBoxMetrics.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render a real grid and hand back the options its controller was built with. */
async function renderAndCaptureOptions(): Promise<ControllerOptions> {
  const { container } = render(
    <PretableSurface
      ariaLabel="Estimator wiring grid"
      columns={columns}
      getRowId={(row) => row.id}
      overscan={0}
      rows={rows}
      viewportHeight={120}
    />,
  );
  await waitFor(() => {
    expect(
      container.querySelectorAll("[data-pretable-row]").length,
    ).toBeGreaterThan(0);
  });
  expect(controllerOptions).toHaveLength(1);
  return controllerOptions[0]!;
}

describe("the model hands the row layout controller its measured text metrics", () => {
  test("getAverageCharWidthPx resolves the measured font width", async () => {
    averageCharWidth.mockReturnValue(6.505112214977034);
    const options = await renderAndCaptureOptions();

    expect(options.getAverageCharWidthPx).toBeTypeOf("function");
    expect(options.getAverageCharWidthPx?.()).toBe(6.505112214977034);

    // And it is a getter, not a value captured at construction: the font is
    // only measurable once a cell has painted, which is after this object was
    // built. A line that read the width eagerly would pass null for ever.
    averageCharWidth.mockReturnValue(9);
    expect(options.getAverageCharWidthPx?.()).toBe(9);
  });

  test("getRowBoxMetrics resolves the theme's row box", async () => {
    const box: RowBoxMetrics = Object.freeze({
      lineHeightPx: 21,
      paddingXPx: 16,
      paddingYPx: 12,
      borderPx: 1,
    });
    rowBoxMetrics.mockReturnValue(box);
    const options = await renderAndCaptureOptions();

    expect(options.getRowBoxMetrics).toBeTypeOf("function");
    // Identity, not equality. The estimate memo compares the box by reference,
    // so a wiring line that copied or re-froze it would miss the memo on every
    // row while still passing a deep-equality check.
    expect(options.getRowBoxMetrics?.()).toBe(box);
  });

  test("getSegmentMeasurer resolves the canvas-backed measurer", async () => {
    const measurer = (segment: string) => segment.length * 6;
    segmentMeasurer.mockReturnValue(measurer);
    const options = await renderAndCaptureOptions();

    expect(options.getSegmentMeasurer).toBeTypeOf("function");
    // Identity again, and for the same reason: `text-metrics` returns one
    // function per font precisely so the memo key can compare it by reference.
    expect(options.getSegmentMeasurer?.()).toBe(measurer);
  });

  test("getLetterSpacingPx resolves the cell's CSS letter spacing", async () => {
    letterSpacing.mockReturnValue(0.25);
    const options = await renderAndCaptureOptions();

    expect(options.getLetterSpacingPx).toBeTypeOf("function");
    expect(options.getLetterSpacingPx?.()).toBe(0.25);
  });

  test("all four are absent-safe: null flows through, it does not throw", async () => {
    // The pre-paint and no-canvas case, which is every server render and every
    // other jsdom test in this package. Null must reach the controller as null.
    const options = await renderAndCaptureOptions();
    expect(options.getAverageCharWidthPx?.()).toBeNull();
    expect(options.getRowBoxMetrics?.()).toBeNull();
    expect(options.getSegmentMeasurer?.()).toBeNull();
    expect(options.getLetterSpacingPx?.()).toBeNull();
  });
});
