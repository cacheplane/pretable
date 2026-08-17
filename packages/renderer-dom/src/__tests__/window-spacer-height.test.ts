import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowModel,
  type PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import {
  createRowLayoutController,
  type RowLayoutScheduler,
} from "../row-layout-controller";
import type { RowLayoutController } from "../types";

/**
 * What PIXEL height does a window spacer actually get?
 *
 * `eviction-anchor.test.ts` in layout-core looks like it settles this. It does
 * not: it calls `planViewport({ leadingHeight: sumHeights(0, EVICT_BEFORE) })`
 * — the exact sum of the evicted rows' measured heights, computed by the test
 * itself. `planViewport` is pure and spends whatever number it is handed, so
 * the assertion is real but the quantity is not one production ever computes.
 *
 * These tests drive `createRowLayoutController`, which is the thing that has
 * to decide the spacer's height from the row COUNTS `getWindowSpacers`
 * returns. Three properties of the fixture are load-bearing:
 *
 *  - **Measured heights differ from `defaultRowHeight`.** Sizing a spacer at
 *    `rows × defaultRowHeight` is invisible on a grid whose rows are the
 *    default height, which is every browser fixture in this repo.
 *  - **They VARY between rows.** A uniform non-default height would let an
 *    arithmetic error land on a multiple of the row height and look right.
 *  - **The spacer is nonzero.** With no window every conversion below is the
 *    identity, and the whole file is vacuous.
 */

type Row = { id: number; score: number; label: string };

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("score", { type: "number" }),
  helper.accessor("label", { type: "text" }),
] as const;
const renderColumns = [{ id: "label", header: "Label", widthPx: 90 }] as const;

const data = (rowId: number): PretableVisibleRowRef<number> => ({
  kind: "data",
  rowId,
});

/** Rows 0..49 of a 10,000-row dataset: the window starts at 5,000. */
const LOADED_ROWS = 50;
const LEADING_ROWS = 5_000;
const TRAILING_ROWS = 4_950;
const DEFAULT_ROW_HEIGHT = 30;
const VIEWPORT = 400;

/** 30..52, never a multiple of anything the arithmetic could land on by luck. */
const heightAt = (index: number) => DEFAULT_ROW_HEIGHT + ((index * 7) % 23);

const sumHeights = (from: number, to: number): number => {
  let total = 0;
  for (let index = from; index < to; index += 1) total += heightAt(index);
  return total;
};

/** 2,048px over 50 rows — a 40.96px mean against a 30px default. */
const MEASURED_MEAN = sumHeights(0, LOADED_ROWS) / LOADED_ROWS;

class ImmediateScheduler implements RowLayoutScheduler {
  readonly tasks: Array<{ task: () => void; cancelled: boolean }> = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.tasks.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushAll(limit = 100_000): void {
    let count = 0;
    for (;;) {
      const entry = this.tasks.shift();
      if (entry === undefined) return;
      if (!entry.cancelled) entry.task();
      count += 1;
      if (count > limit) throw new Error("Scheduler did not settle.");
    }
  }
}

const rowsFrom = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, offset) => ({
    id: from + offset,
    score: from + offset,
    label: `row ${from + offset}`,
  }));

function createWindowedController(spacers: {
  leadingRows: number;
  trailingRows: number;
}): {
  readonly controller: RowLayoutController<Row, number, typeof modelColumns>;
  readonly model: PretableRowModel<Row, number, typeof modelColumns>;
  readonly scheduler: ImmediateScheduler;
} {
  const model = createLocalRowModel({
    rows: rowsFrom(0, LOADED_ROWS),
    columns: modelColumns,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    },
  });
  const scheduler = new ImmediateScheduler();
  const controller = createRowLayoutController({
    model,
    columns: renderColumns,
    viewport: { scrollTop: 0, viewportHeight: VIEWPORT, overscan: 0 },
    scheduler,
    now: () => 0,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    estimateRowHeight: (row: Row) => heightAt(row.score),
    getWindowSpacers: () => spacers,
  });
  scheduler.flushAll();
  expect(controller.getState().status.kind).toBe("ready");
  return { controller, model, scheduler };
}

/**
 * Report the DOM's height for every loaded row, the way a real render does.
 *
 * These are measurements, not estimates: they land in the height index's
 * measurement cache, which is the only record of what a row is actually worth
 * once it stops being drawn.
 */
function measureLoadedRows(
  controller: RowLayoutController<Row, number, typeof modelColumns>,
  from: number,
  count: number,
): void {
  for (let offset = 0; offset < count; offset += 1) {
    const index = from + offset;
    controller.measure(data(index), heightAt(index));
  }
}

describe("window spacer height", () => {
  test("the spacer is sized from what rows measured, not from the default height", () => {
    const spacers = {
      leadingRows: LEADING_ROWS,
      trailingRows: TRAILING_ROWS,
    };
    const { controller } = createWindowedController(spacers);
    measureLoadedRows(controller, 0, LOADED_ROWS);

    const state = controller.getState();
    const loadedHeight = state.rowHeights.getTotalHeight();
    // The measurements landed, so everything below is about the spacer rather
    // than about nothing having happened.
    expect(loadedHeight).toBe(sumHeights(0, LOADED_ROWS));

    const leadingTruth = LEADING_ROWS * MEASURED_MEAN;
    const trailingTruth = TRAILING_ROWS * MEASURED_MEAN;

    expect
      .soft(state.leadingHeight, "the leading spacer at the measured mean")
      .toBeCloseTo(leadingTruth, 6);
    expect
      .soft(state.totalHeight, "the whole extent at the measured mean")
      .toBeCloseTo(leadingTruth + loadedHeight + trailingTruth, 6);
    // The extent is the population at the mean, end to end.
    expect
      .soft(state.totalHeight, "10,000 rows at the measured mean")
      .toBeCloseTo(
        (LEADING_ROWS + LOADED_ROWS + TRAILING_ROWS) * MEASURED_MEAN,
        6,
      );
  });

  test("a spacer for EVICTED rows is sized from the measurements they left behind", () => {
    // Rows 0..49 are loaded and measured, then the window moves on to rows
    // 50..99. The first fifty stop being rows and become spacer, and their
    // heights survive only as retained measurements — which is the case the
    // eviction feature exists for.
    const spacers = {
      leadingRows: LEADING_ROWS,
      trailingRows: TRAILING_ROWS,
    };
    const { controller, model, scheduler } = createWindowedController(spacers);
    measureLoadedRows(controller, 0, LOADED_ROWS);

    model.setRows(rowsFrom(LOADED_ROWS, LOADED_ROWS));
    spacers.leadingRows = LEADING_ROWS + LOADED_ROWS;
    spacers.trailingRows = TRAILING_ROWS - LOADED_ROWS;
    scheduler.flushAll();

    const state = controller.getState();
    expect(state.status.kind).toBe("ready");
    // The window really did move, and NOT ONE loaded row is measured — so any
    // calibration the spacer shows can only have come from the fifty evicted
    // rows' retained measurements.
    expect(state.rowHeights.keyAt(0)).toEqual(data(LOADED_ROWS));
    for (let offset = 0; offset < LOADED_ROWS; offset += 1) {
      expect(
        state.rowHeights.hasMeasurement(data(LOADED_ROWS + offset)),
        `loaded row ${LOADED_ROWS + offset} is unmeasured`,
      ).toBe(false);
    }

    expect
      .soft(state.leadingHeight, "5,050 evicted rows at their measured mean")
      .toBeCloseTo(spacers.leadingRows * MEASURED_MEAN, 6);
    expect
      .soft(state.totalHeight, "the extent after the window moved")
      .toBeCloseTo(
        spacers.leadingRows * MEASURED_MEAN +
          state.rowHeights.getTotalHeight() +
          spacers.trailingRows * MEASURED_MEAN,
        6,
      );
  });

  test("CONTROL: nothing measured, so the spacer is still the default height", () => {
    // Cold start, and every non-windowed grid: with no measurement to
    // calibrate against, the spacer is `rows × defaultRowHeight` exactly as
    // before. This is the regression guard for the unwindowed path.
    const { controller } = createWindowedController({
      leadingRows: LEADING_ROWS,
      trailingRows: TRAILING_ROWS,
    });

    const state = controller.getState();
    expect(state.leadingHeight).toBe(LEADING_ROWS * DEFAULT_ROW_HEIGHT);
    expect(state.totalHeight).toBe(
      LEADING_ROWS * DEFAULT_ROW_HEIGHT +
        state.rowHeights.getTotalHeight() +
        TRAILING_ROWS * DEFAULT_ROW_HEIGHT,
    );
  });
});
