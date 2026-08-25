import { describe, expect, test } from "vitest";

import { createColumnHelper, type PretableVisibleRowRef } from "@pretable/core";
import { createLocalRowModel } from "@pretable-internal/row-model";

import {
  createRowLayoutController,
  getRowLayoutControllerDiagnosticsForTesting,
  type RowLayoutScheduler,
} from "../row-layout-controller";

/**
 * The dense-identity layout seam (Amendment I): a FLAT row-model snapshot
 * supplies model slots (`ɵvisibleSlotRange` / `ɵslotCapacity` /
 * `ɵslotOfRowId`), so the controller builds the height index in the DENSE
 * lane — slot-keyed sources, slot-stamped operations, and slot-pooled frozen
 * row refs — while a grouped snapshot falls back to today's string-identity
 * shape wholesale.
 */

type Row = {
  id: number | string;
  team: string;
  score: number;
  label: string;
};

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;
const renderColumns = [
  { id: "label", header: "Label", wrap: true, widthPx: 90 },
  { id: "score", header: "Score", widthPx: 80 },
] as const;

const data = (rowId: Row["id"]): PretableVisibleRowRef<Row["id"]> => ({
  kind: "data",
  rowId,
});

class ManualScheduler implements RowLayoutScheduler {
  readonly tasks: Array<{ task: () => void; cancelled: boolean }> = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.tasks.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushOne(): boolean {
    const entry = this.tasks.shift();
    if (!entry) return false;
    if (!entry.cancelled) entry.task();
    return true;
  }

  flushAll(limit = 10_000): void {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

const tenRows: readonly Row[] = Array.from({ length: 10 }, (_, index) => ({
  id: `r${index}`,
  team: index % 2 === 0 ? "A" : "B",
  score: index,
  label: `row ${index}`,
}));

function createModel(
  rows: readonly Row[],
  options: { readonly grouped?: boolean } = {},
) {
  return createLocalRowModel({
    rows,
    columns: modelColumns,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: options.grouped ? [{ columnId: "team" }] : [],
    },
  });
}

function createReadyController(
  model: ReturnType<typeof createModel>,
  scheduler = new ManualScheduler(),
) {
  const controller = createRowLayoutController({
    model,
    columns: renderColumns,
    viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
    scheduler,
    now: () => 0,
    budgetMs: 5,
    maxUnitsPerSlice: 256,
  });
  scheduler.flushAll();
  expect(controller.getState().status.kind).toBe("ready");
  return { controller, scheduler };
}

/**
 * The lane probe: on a DENSE generation, layout-core refuses any operation
 * that arrives without a `denseKey` (the fallback contract). A string-lane
 * generation accepts the same operation. `apply` is persistent and throws
 * before producing anything, so probing never perturbs the published index.
 */
function isDenseIndex(
  controller: ReturnType<typeof createReadyController>["controller"],
  ref: PretableVisibleRowRef<Row["id"]>,
): boolean {
  const rowHeights = controller.getState().rowHeights;
  try {
    rowHeights.apply([{ kind: "update", ref, index: 0 }]);
    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/dense/i);
    return true;
  }
}

/**
 * Wraps a model so every published snapshot counts its per-row and bulk
 * reads. Wrapper identity is memoized per underlying snapshot: the
 * controller compares snapshots by reference across wakes.
 */
function instrumentModel(model: ReturnType<typeof createModel>) {
  type ModelSnapshot = ReturnType<
    ReturnType<typeof createModel>["getState"]
  >["snapshot"];
  const counters = {
    rowAt: 0,
    rangeCalls: [] as Array<readonly [number, number]>,
    slotRangeCalls: [] as Array<readonly [number, number]>,
  };
  const wrapped = new WeakMap<object, ModelSnapshot>();
  const wrapSnapshot = (snapshot: ModelSnapshot): ModelSnapshot => {
    const existing = wrapped.get(snapshot);
    if (existing !== undefined) {
      return existing;
    }
    // Spread rather than Proxy: published snapshots are frozen, and a Proxy
    // over a frozen target may not report a different function for a
    // non-configurable data property.
    const slotRange = snapshot.ɵvisibleSlotRange?.bind(snapshot);
    const instrumentedSnapshot = Object.freeze({
      ...snapshot,
      rowAt(index: number) {
        counters.rowAt += 1;
        return snapshot.rowAt(index);
      },
      range(start: number, end: number) {
        counters.rangeCalls.push([start, end]);
        return snapshot.range(start, end);
      },
      ...(slotRange === undefined
        ? {}
        : {
            ɵvisibleSlotRange(start: number, end: number) {
              counters.slotRangeCalls.push([start, end]);
              return slotRange(start, end);
            },
          }),
    });
    wrapped.set(snapshot, instrumentedSnapshot);
    return instrumentedSnapshot;
  };
  const instrumented = new Proxy(model, {
    get(target, property, receiver) {
      if (property === "getState") {
        return () => {
          const state = model.getState();
          return { ...state, snapshot: wrapSnapshot(state.snapshot) };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { instrumented, counters };
}

describe("dense-identity layout seam", () => {
  test("a flat snapshot builds a DENSE height index through bounded bulk range walks", () => {
    // 300 rows: the build must cross a chunk boundary, so the walk shape —
    // bounded bulk chunks, slots aligned, zero per-row descents — is
    // actually exercised rather than collapsing into one tiny read.
    const rows = Array.from({ length: 300 }, (_, index) => ({
      id: `r${index}`,
      team: index % 2 === 0 ? "A" : "B",
      score: index,
      label: `row ${index}`,
    }));
    const model = createModel(rows);
    const { instrumented, counters } = instrumentModel(model);
    const { controller } = createReadyController(
      instrumented as ReturnType<typeof createModel>,
    );

    // The replacement source materialized the visible set through chunked
    // bulk `range` walks — bounded per call, never the whole dataset at
    // once — with the slot reads aligned chunk-for-chunk, and the per-row
    // `rowAt` rank descents are gone from the build path entirely.
    const buildWalks = counters.rangeCalls.filter(
      ([start, end]) => end - start > 12,
    );
    expect(buildWalks).toEqual([
      [0, 256],
      [256, 300],
    ]);
    expect(
      counters.slotRangeCalls.filter(([start, end]) => end - start > 12),
    ).toEqual([
      [0, 256],
      [256, 300],
    ]);
    expect(counters.rowAt).toBe(0);

    // The published index is a dense generation: an operation without a
    // `denseKey` is refused by layout-core's guard.
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
  });

  test("a grouped snapshot falls back to the string lane wholesale", () => {
    const model = createModel(tenRows, { grouped: true });
    const { controller } = createReadyController(model);
    const state = controller.getState();
    expect(state.snapshot?.ɵvisibleSlotRange?.(0, 1)).toBeUndefined();

    // A group ref at index 0 (expanded grouping leads with a group row); the
    // string lane accepts the un-keyed operation, proving no denseCapacity
    // was declared.
    const ref = state.window[0]!.ref;
    expect(() =>
      state.rowHeights.apply([{ kind: "update", ref, index: 0 }]),
    ).not.toThrow();
  });

  test("incremental change operations are slot-stamped, so a dense index absorbs them without fallback", () => {
    const model = createModel(tenRows);
    const { controller } = createReadyController(model);
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
    const before = getRowLayoutControllerDiagnosticsForTesting(controller);

    // An update (relabel), a remove (drop r3), and an insert (new r10), each
    // an incremental "changes" sequence over the SAME dense index. Any
    // missing denseKey would throw inside `apply` and restart a full
    // replacement, which `replacementStartCount` would expose. The REMOVE is
    // the deliberately hard one: the removed row's slot is only still bound
    // in the PRE-change snapshot.
    model.applyTransaction({
      update: tenRows.map((row) => ({
        id: row.id,
        changes: { label: `${row.label}!` },
      })),
    });
    expect(controller.getState().status.kind).toBe("ready");
    model.applyTransaction({ remove: ["r3"] });
    expect(controller.getState().status.kind).toBe("ready");
    model.applyTransaction({
      add: [{ id: "r10", team: "A", score: 10, label: "row 10" }],
    });

    const state = controller.getState();
    expect(state.status.kind).toBe("ready");
    expect(state.snapshot?.visibleRowCount).toBe(10);
    const diagnostics = getRowLayoutControllerDiagnosticsForTesting(controller);
    expect(diagnostics.replacementStartCount).toBe(
      before.replacementStartCount,
    );
    // Still dense after the incremental ops.
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
  });

  test("a dense refilter round-trip keeps measurements with zero fallbacks", () => {
    const model = createModel(tenRows);
    const { controller } = createReadyController(model);
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
    controller.measure(data("r0"), 61);
    controller.measure(data("r1"), 62);
    const before = getRowLayoutControllerDiagnosticsForTesting(controller);

    model.setQuery({
      filters: [{ columnId: "score", operator: "gt", value: 4 }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    expect(controller.getState().snapshot?.visibleRowCount).toBe(5);
    model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });

    const state = controller.getState();
    expect(state.status.kind).toBe("ready");
    expect(state.snapshot?.visibleRowCount).toBe(10);
    const diagnostics = getRowLayoutControllerDiagnosticsForTesting(controller);
    expect(diagnostics.refilterPathCount).toBe(before.refilterPathCount + 2);
    expect(diagnostics.refilterFallbackCount).toBe(
      before.refilterFallbackCount,
    );
    expect(diagnostics.replacementStartCount).toBe(
      before.replacementStartCount,
    );
    // The measured heights returned with their rows.
    expect(
      state.rowHeights.getHeight(state.snapshot!.indexOf(data("r0"))),
    ).toBe(61);
    expect(
      state.rowHeights.getHeight(state.snapshot!.indexOf(data("r1"))),
    ).toBe(62);
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
  });

  test("data-row refs are pooled by slot and reused across publications", () => {
    const model = createModel(tenRows);
    const { controller, scheduler } = createReadyController(model);
    const refOf = (rowId: Row["id"]) =>
      controller
        .getState()
        .window.find(
          (row) => row.ref.kind === "data" && row.ref.rowId === rowId,
        )?.ref;
    const first = refOf("r0");
    expect(first).toBeDefined();

    // Across a filter-only commit (dense refilter) …
    model.setQuery({
      filters: [{ columnId: "score", operator: "lt", value: 5 }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    expect(controller.getState().status.kind).toBe("ready");
    expect(refOf("r0")).toBe(first);

    // … and across a FULL replacement (a column change rebuilds the index
    // from a fresh source), the same frozen ref object is reused while the
    // rowId still owns its slot.
    controller.setColumns([
      { id: "label", wrap: true, widthPx: 140 },
      { id: "score", widthPx: 80 },
    ]);
    scheduler.flushAll();
    expect(controller.getState().status.kind).toBe("ready");
    expect(refOf("r0")).toBe(first);
  });

  test("a staged measurement for a filtered-out row is retained through a dense restart", () => {
    const model = createModel(tenRows);
    const { controller, scheduler } = createReadyController(model);
    expect(isDenseIndex(controller, data("r0"))).toBe(true);

    // Retained state keeps the column-change reset cooperative (a bare mount
    // base would complete it inline and nothing would ever be staged).
    controller.measure(data("r0"), 50);
    // Open a replacement (column change), stage a measurement while it is in
    // flight, then filter the measured row OUT — a mid-replacement refilter
    // fails closed into a restart whose staged replay must retain the
    // now-absent row's measurement on the DENSE candidate (slot-keyed
    // `retainMeasurement`).
    controller.setColumns([
      { id: "label", wrap: true, widthPx: 140 },
      { id: "score", widthPx: 80 },
    ]);
    controller.measure(data("r1"), 63);
    model.setQuery({
      filters: [{ columnId: "score", operator: "gt", value: 4 }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    scheduler.flushAll();
    expect(controller.getState().status.kind).toBe("ready");
    expect(controller.getState().snapshot?.visibleRowCount).toBe(5);

    // Widen the filter back: r1 re-enters with its retained 63px, never
    // re-measured.
    model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    scheduler.flushAll();
    const state = controller.getState();
    expect(state.status.kind).toBe("ready");
    expect(state.rowHeights.hasMeasurement(data("r1"))).toBe(true);
    expect(
      state.rowHeights.getHeight(state.snapshot!.indexOf(data("r1"))),
    ).toBe(63);
    // The retention was honored ON the dense candidate (slot-keyed): the
    // published index never dropped to the string lane, which is what an
    // unstamped `retainMeasurement` would have forced.
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
  });

  test("a staged measurement for a permanently removed row drops the generation to the string lane, keeping retention", () => {
    const model = createModel(tenRows);
    const { controller, scheduler } = createReadyController(model);

    // Same orchestration, but the measured row is REMOVED from the dataset
    // entirely: its slot is released, so a dense candidate cannot retain the
    // measurement — and must neither replay the refusal forever nor drop the
    // retention. The amendment's escape hatch fires instead: this ONE
    // generation falls back to the string lane, where retention is
    // identity-keyed, and a later re-insert of the same rowId restores the
    // measured height.
    //
    // Retained state keeps the column-change reset cooperative (a bare mount
    // base would complete it inline and nothing would ever be staged).
    controller.measure(data("r0"), 50);
    controller.setColumns([
      { id: "label", wrap: true, widthPx: 140 },
      { id: "score", widthPx: 80 },
    ]);
    controller.measure(data("r1"), 63);
    model.setRows(tenRows.filter((row) => row.id !== "r1"));
    scheduler.flushAll();
    const settled = controller.getState();
    expect(settled.status.kind).toBe("ready");
    expect(settled.snapshot?.visibleRowCount).toBe(9);
    expect(settled.rowHeights.hasMeasurement(data("r1"))).toBe(true);
    expect(isDenseIndex(controller, data("r0"))).toBe(false);

    model.applyTransaction({
      add: [{ id: "r1", team: "B", score: 1, label: "row 1 again" }],
    });
    const reinserted = controller.getState();
    expect(reinserted.status.kind).toBe("ready");
    const rank = reinserted.snapshot!.indexOf(data("r1"));
    expect(reinserted.rowHeights.getHeight(rank)).toBe(63);
    expect(reinserted.rowHeights.hasMeasurement(data("r1"))).toBe(true);

    // The string lane lasts one generation: the next FULL replacement
    // re-decides dense.
    controller.setColumns([
      { id: "label", wrap: true, widthPx: 90 },
      { id: "score", widthPx: 80 },
    ]);
    scheduler.flushAll();
    expect(controller.getState().status.kind).toBe("ready");
    expect(isDenseIndex(controller, data("r0"))).toBe(true);
  });
});
