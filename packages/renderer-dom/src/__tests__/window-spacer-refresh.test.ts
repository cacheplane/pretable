import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowModel,
  type PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import {
  createRowLayoutController,
  getRowLayoutControllerDiagnosticsForTesting,
  type RowLayoutScheduler,
} from "../row-layout-controller";
import type { RowLayoutController } from "../types";

/**
 * `refreshWindowSpacers` — the controller's only path to a window that moved
 * without the rows moving with it.
 *
 * The spacer counts come from the consumer's `resultMeta`, which can change
 * with the row set byte-identical: a count query lands and an estimated total
 * turns exact at the same window. An identical row set is not an effective
 * model write, so no revision is published and nothing else would ever
 * replan; the drawn leading spacer and scroll extent would stay at the old
 * geometry indefinitely on a grid whose loaded window fits its viewport,
 * because the collapsed extent leaves nothing to scroll and a scroll is what
 * would have replanned.
 *
 * Its caller fires it on EVERY commit, so the two properties that matter are
 * symmetric: it must redraw when the spacers really moved, and it must cost
 * nothing when they did not — the second is what keeps it off the streaming
 * path, where every effective row change moves `trailingRows` and the
 * replacement it triggers has already drawn the new geometry.
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

const LOADED_ROWS = 50;
const ROW_HEIGHT = 30;
const VIEWPORT = 400;

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

/**
 * A grid whose loaded window is all it can see — the shut-gate state. The
 * mutable `spacers` object is the consumer's `resultMeta`: the test moves it
 * and then tells the controller to look again, exactly as the React layer's
 * layout effect does.
 */
function createController(spacers: {
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
    defaultRowHeight: ROW_HEIGHT,
    estimateRowHeight: () => ROW_HEIGHT,
    getWindowSpacers: () => spacers,
  });
  scheduler.flushAll();
  for (let index = 0; index < LOADED_ROWS; index += 1) {
    controller.measure(data(index), ROW_HEIGHT);
  }
  expect(controller.getState().status.kind).toBe("ready");
  return { controller, model, scheduler };
}

const refreshCounts = (controller: object) => {
  const diagnostics = getRowLayoutControllerDiagnosticsForTesting(controller);
  return {
    refreshed: diagnostics.windowSpacerRefreshCount,
    fell_back: diagnostics.windowSpacerRefreshFallbackCount,
  };
};

describe("refreshWindowSpacers", () => {
  test("redraws the spacer and the extent when the window reopens under identical rows", () => {
    // The gate is shut: 50 loaded rows and no window at all.
    const spacers = { leadingRows: 0, trailingRows: 0 };
    const { controller } = createController(spacers);
    expect(controller.getState().leadingHeight).toBe(0);
    expect(controller.getState().totalHeight).toBe(LOADED_ROWS * ROW_HEIGHT);

    // The count query lands. Rows 0..49 turn out to be rows 100..149 of a
    // 1,000-row population — and not one row changed, so nothing else in the
    // system has an event to offer.
    spacers.leadingRows = 100;
    spacers.trailingRows = 850;
    controller.refreshWindowSpacers();

    const state = controller.getState();
    expect(state.leadingHeight).toBe(100 * ROW_HEIGHT);
    expect(state.totalHeight).toBe(1_000 * ROW_HEIGHT);
    expect(refreshCounts(controller)).toEqual({ refreshed: 1, fell_back: 0 });
  });

  test("holds the rows on screen: the spacer moves the offset, not the reader", () => {
    const spacers = { leadingRows: 0, trailingRows: 0 };
    const { controller } = createController(spacers);
    // Parked on row 10 — a position with rows above it, so an anchor that
    // silently reset to zero would be visible.
    controller.setViewport({
      scrollTop: 10 * ROW_HEIGHT,
      viewportHeight: VIEWPORT,
      overscan: 0,
    });
    expect(controller.getState().window[0]?.ref).toEqual(data(10));

    spacers.leadingRows = 100;
    spacers.trailingRows = 850;
    controller.refreshWindowSpacers();

    const state = controller.getState();
    // The same row is still the first one drawn, at the same distance below
    // the (now 100-row) spacer. The GLOBAL offset absorbed the whole change.
    expect(state.window[0]?.ref).toEqual(data(10));
    expect(state.scrollTop).toBe(110 * ROW_HEIGHT);
  });

  test("costs nothing when the drawn spacers are already current", () => {
    // The negative twin, and the reason the caller may fire this every
    // commit. Without it the test above is satisfied by a method that
    // republishes unconditionally.
    const spacers = { leadingRows: 100, trailingRows: 850 };
    const { controller } = createController(spacers);
    const before = controller.getState();
    expect(before.leadingHeight).toBe(100 * ROW_HEIGHT);

    controller.refreshWindowSpacers();
    controller.refreshWindowSpacers();

    // Not merely equal — the SAME state object, so nothing was republished
    // and no subscriber was notified.
    expect(controller.getState()).toBe(before);
    expect(refreshCounts(controller)).toEqual({ refreshed: 0, fell_back: 0 });
  });

  test("costs nothing when a replan has already absorbed the change", () => {
    // The streaming shape: the row set changes, so `trailingRows` changes
    // with it, and the replacement the model write triggers plans against the
    // new counts. The refresh that follows in the same commit must find
    // nothing left to do — this is the whole cost argument.
    const spacers = { leadingRows: 100, trailingRows: 850 };
    const { controller, model, scheduler } = createController(spacers);

    model.setRows(rowsFrom(0, LOADED_ROWS + 10));
    spacers.trailingRows = 840;
    scheduler.flushAll();
    const settled = controller.getState();

    controller.refreshWindowSpacers();

    expect(controller.getState()).toBe(settled);
    expect(refreshCounts(controller)).toEqual({ refreshed: 0, fell_back: 0 });
  });

  test("a disposed controller answers that it has nothing to redraw", () => {
    // Not a throw, unlike `setColumns`/`setViewport`. Those carry consumer
    // intent; this one is fired unconditionally by a layout effect that can
    // still run a commit after an explicit-model consumer disposed the model.
    const spacers = { leadingRows: 0, trailingRows: 0 };
    const { controller } = createController(spacers);
    controller.dispose();
    spacers.leadingRows = 100;

    expect(() => controller.refreshWindowSpacers()).not.toThrow();
    expect(refreshCounts(controller)).toEqual({ refreshed: 0, fell_back: 0 });
  });
});
