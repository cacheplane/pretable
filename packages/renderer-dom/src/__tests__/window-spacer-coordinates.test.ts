import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableVisibleRowRef,
} from "@pretable/core";

import {
  createRowLayoutController,
  type RowLayoutScheduler,
} from "../row-layout-controller";
import type { RowLayoutController } from "../types";

/**
 * The controller's two coordinate spaces, exercised where they actually
 * DIFFER.
 *
 * Every other test in this package runs with no window spacers, and a grep for
 * `getWindowSpacers` across `packages/` and `apps/` found no test file at all
 * before this one. That is not a small gap: with `leadingHeight = 0` the entire
 * conversion seam — `toLocalOffset`, `resolveScrollRequest`, the global clamp —
 * is the identity function, so a suite can be fully green with every one of
 * those conversions deleted. It was: removing the `toLocalOffset` call in
 * `captureAnchor` left grid-core, layout-core, renderer-dom, react and the
 * browser suite all passing.
 *
 * Two properties of this fixture are load-bearing, and each closes a way the
 * tests below could pass vacuously:
 *
 *  - **A nonzero leading spacer.** Without it, local and global coincide and
 *    nothing here can distinguish them.
 *  - **VARIED row heights.** A uniform grid lets a wrong answer look right,
 *    because every arithmetic mistake lands on a multiple of the row height —
 *    and worse, `measure()` short-circuits at `root === state.rowHeights` when
 *    the measured height equals the estimate, so the anchoring path is never
 *    reached at all. The browser fixtures pin `--pretable-row-height: 48` and
 *    are vacuous for exactly that reason. Same intent as `heightAt` in
 *    layout-core's `eviction-anchor.test.ts`.
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
const LEADING_HEIGHT = LEADING_ROWS * DEFAULT_ROW_HEIGHT;
const TRAILING_HEIGHT = TRAILING_ROWS * DEFAULT_ROW_HEIGHT;
const VIEWPORT = 400;

/** 30..52, never a multiple of anything the arithmetic could land on by luck. */
const heightAt = (index: number) => DEFAULT_ROW_HEIGHT + ((index * 7) % 23);

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

function createWindowedController(): {
  readonly controller: RowLayoutController<Row, number, typeof modelColumns>;
  readonly scheduler: ImmediateScheduler;
} {
  const model = createLocalRowModel({
    rows: Array.from({ length: LOADED_ROWS }, (_, index) => ({
      id: index,
      score: index,
      label: `row ${index}`,
    })),
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
    getWindowSpacers: () => ({
      leadingRows: LEADING_ROWS,
      trailingRows: TRAILING_ROWS,
    }),
  });
  scheduler.flushAll();
  expect(controller.getState().status.kind).toBe("ready");
  return { controller, scheduler };
}

/**
 * Park the viewport so local row `index` sits `into` px below the fold, and
 * settle.
 *
 * Two passes on purpose: the height index only estimates rows a plan has
 * actually visited, so the first park is what brings rows above the target
 * to their real heights, and the offset is only trustworthy on the read
 * AFTER it. Everything is taken from the controller's own index rather than
 * a precomputed sum, so the fixture cannot drift from the thing it measures.
 */
function parkAtLocalRow(
  controller: RowLayoutController<Row, number, typeof modelColumns>,
  index: number,
  into = 0,
): number {
  for (let pass = 0; pass < 2; pass += 1) {
    const local = controller.getState().rowHeights.getOffsetForIndex(index);
    controller.setViewport({
      scrollTop: LEADING_HEIGHT + local + into,
      viewportHeight: VIEWPORT,
      overscan: 0,
    });
  }
  return controller.getState().scrollTop;
}

function topOf(
  controller: RowLayoutController<Row, number, typeof modelColumns>,
  index: number,
): number {
  const row = controller
    .getState()
    .window.find((entry) => entry.index === index);
  expect(row, `row ${index} is in the published window`).toBeDefined();
  return row!.top;
}

/**
 * Where local row `index` sits ON SCREEN — its top edge relative to the
 * viewport's. `null` when it is not drawn at all, which is itself a failure
 * mode worth reporting rather than throwing on.
 *
 * This, not the absolute scroll offset, is the thing anchoring promises.
 */
function screenYOf(
  controller: RowLayoutController<Row, number, typeof modelColumns>,
  index: number,
): number | null {
  const state = controller.getState();
  const row = state.window.find((entry) => entry.index === index);
  return row === undefined ? null : row.top - state.scrollTop;
}

describe("windowed scroll coordinates", () => {
  test("the scroll extent is the whole dataset, and the clamp respects it", () => {
    const { controller } = createWindowedController();
    const loadedHeight = controller.getState().rowHeights.getTotalHeight();

    controller.setViewport({
      scrollTop: 1_000_000,
      viewportHeight: VIEWPORT,
      overscan: 0,
    });
    const state = controller.getState();

    expect(state.leadingHeight).toBe(LEADING_HEIGHT);
    expect(state.totalHeight).toBe(
      LEADING_HEIGHT + state.rowHeights.getTotalHeight() + TRAILING_HEIGHT,
    );
    // Clamped against the GLOBAL extent. Clamping against the loaded rows'
    // own height — what shipped — would pin this at `loadedHeight - VIEWPORT`,
    // about 1,650 against a ~300,000px content div, and no scroll position
    // would reach the window.
    expect(state.scrollTop).toBe(state.totalHeight - VIEWPORT);
    expect(state.scrollTop).toBeGreaterThan(loadedHeight);
    expect(state.viewport.scrollTop).toBe(state.scrollTop);
  });

  test("the published scrollTop is in the same space as the published row tops", () => {
    const { controller } = createWindowedController();
    const parked = parkAtLocalRow(controller, 20);
    const state = controller.getState();

    // The round trip: what went in came back, un-reinterpreted.
    expect(state.scrollTop).toBe(parked);
    expect(state.viewport.scrollTop).toBe(parked);
    // And a row's own `top` is directly comparable to it — which is the whole
    // contract, since every consumer subtracts one from the other to decide
    // what is on screen.
    expect(topOf(controller, 20)).toBe(parked);
    expect(state.range.start).toBe(20);
  });

  test("an anchored row holds its on-screen position across a measurement", () => {
    const { controller } = createWindowedController();
    // Partway INTO row 20, not flush with it: a whole-row offset would let an
    // anchor that silently rounds to a row boundary still look right.
    parkAtLocalRow(controller, 20, 11);

    const before = controller.getState();
    const screenYBefore = screenYOf(controller, 20);
    expect(screenYBefore).toBe(-11);

    // Grow a row ABOVE the anchor. Everything below it shifts down by 40px, so
    // holding row 20 still requires the scroll offset to move with it — which
    // is the only reason `captureAnchor` exists.
    controller.measure(data(5), heightAt(5) + 40);

    const after = controller.getState();
    // The measurement landed (the short-circuit at `root === state.rowHeights`
    // did not swallow it), so the assertions below are about anchoring rather
    // than about nothing having happened.
    expect(after.rowHeights.getHeight(5)).toBe(heightAt(5) + 40);
    // Soft, so one run reports the user-visible property AND the mechanism
    // rather than stopping at whichever fails first.
    expect
      .soft(screenYOf(controller, 20), "row 20 has not moved on screen")
      .toBe(screenYBefore);
    // The offset follows the growth AND the spacer above it.
    //
    // This measurement is the grid's first, so it is also the first sample the
    // leading spacer is calibrated from: 5,000 rows go from the 30px default
    // to the one 82px height anybody has reported, and the spacer above the
    // window grows by 260,000px in the same commit. Both terms are required —
    // dropping the spacer term is how this assertion read before spacers were
    // sized from measurements, and dropping the `+ 40` would stop it saying
    // anything about row 5 at all.
    expect
      .soft(after.leadingHeight, "the spacer recalibrated on the first sample")
      .toBe(LEADING_ROWS * (heightAt(5) + 40));
    expect
      .soft(after.scrollTop, "the scroll offset followed both")
      .toBe(
        before.scrollTop + 40 + (after.leadingHeight - before.leadingHeight),
      );
  });

  test("anchoring survives a rebuild that changes the row set", () => {
    const { controller, scheduler } = createWindowedController();
    parkAtLocalRow(controller, 20, 11);
    const screenYBefore = screenYOf(controller, 20);
    expect(screenYBefore).toBe(-11);

    // A cooperative replacement, which restores the anchor through
    // `finishReplacement` rather than through `measure` — the other producer
    // of a LOCAL offset that has to be converted on the way out.
    controller.setColumns([
      { id: "label", header: "Label", widthPx: 120 },
    ] as never);
    scheduler.flushAll();

    const after = controller.getState();
    expect(after.status.kind).toBe("ready");
    // The absolute offset is NOT expected to hold: a replacement rebuilds the
    // height index from estimates, so the geometry above the anchor genuinely
    // changes. What must hold is the thing a user perceives — the row stays
    // where it was on screen — and that the offset is still measured from the
    // dataset's top rather than having collapsed into the window's own space.
    expect
      .soft(screenYOf(controller, 20), "row 20 has not moved on screen")
      .toBe(screenYBefore);
    expect
      .soft(after.scrollTop, "the offset is still measured from the dataset")
      .toBeGreaterThan(LEADING_HEIGHT);
  });

  test("no spacer is the identity case, and still agrees with itself", () => {
    // The control. Every conversion above collapses to the identity here,
    // which is exactly why this whole file had to exist: a suite made only of
    // cases like this one cannot see a broken conversion.
    const model = createLocalRowModel({
      rows: Array.from({ length: LOADED_ROWS }, (_, index) => ({
        id: index,
        score: index,
        label: `row ${index}`,
      })),
      columns: modelColumns,
      initialExpansion: { kind: "expanded" },
      query: { filters: [], sort: [], rowGroups: [] },
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
    });
    scheduler.flushAll();

    const local = controller.getState().rowHeights.getOffsetForIndex(20);
    controller.setViewport({
      scrollTop: local,
      viewportHeight: VIEWPORT,
      overscan: 0,
    });
    const state = controller.getState();
    expect(state.leadingHeight).toBe(0);
    expect(state.totalHeight).toBe(state.rowHeights.getTotalHeight());
    expect(state.scrollTop).toBe(
      state.rowHeights.getOffsetForIndex(state.range.start),
    );
  });
});
