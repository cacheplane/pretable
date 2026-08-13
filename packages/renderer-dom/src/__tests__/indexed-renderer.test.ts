import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableChangeSet,
  type PretableGroupId,
  type PretableVisibleRowRef,
} from "@pretable-internal/row-model";
import * as textCore from "@pretable-internal/text-core";

import {
  createDomRenderSnapshot,
  estimateDomRowHeight,
  planColumnLayout,
} from "../create-renderer";
import {
  createRowLayoutController,
  getRowLayoutControllerDiagnosticsForTesting,
  type RowLayoutScheduler,
} from "../row-layout-controller";
import type { RowLayoutController } from "../types";

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
  readonly cancellationError?: Error;

  constructor(cancellationError?: Error) {
    this.cancellationError = cancellationError;
  }

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.tasks.push(entry);
    return () => {
      entry.cancelled = true;
      if (this.cancellationError) throw this.cancellationError;
    };
  }

  flushOne(): boolean {
    const entry = this.tasks.shift();
    if (!entry) return false;
    if (!entry.cancelled) entry.task();
    return true;
  }

  flushAll(limit = 100_000): void {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

function flushNextLive(scheduler: ManualScheduler): boolean {
  while (scheduler.tasks.length > 0) {
    const entry = scheduler.tasks.shift()!;
    if (entry.cancelled) continue;
    entry.task();
    return true;
  }
  return false;
}

function createModel(
  rows: readonly Row[],
  options: {
    readonly grouped?: boolean;
    readonly journalCapacity?: number;
  } = {},
) {
  return createLocalRowModel({
    rows,
    columns: modelColumns,
    changeJournalCapacity: options.journalCapacity,
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
  columns = renderColumns,
) {
  const controller = createRowLayoutController({
    model,
    columns,
    viewport: {
      scrollTop: 0,
      viewportHeight: 88,
      overscan: 1,
    },
    scheduler,
    now: () => 0,
    budgetMs: 5,
    maxUnitsPerSlice: 256,
  });
  scheduler.flushAll();
  expect(controller.getState().status.kind).toBe("ready");
  return { controller, scheduler };
}

describe("indexed DOM row layout controller", () => {
  test("an unwrapped row estimates at the base height it is given", () => {
    // The baseline used to be a private 44 in this module, which made it a
    // second floor underneath the controller's own `defaultRowHeight` — a
    // themed grid asking for 20px rows got `Math.max(20, 44)` and never saw
    // its own density. Themes ship row heights from 20px (Excel compact) to
    // 56px (spacious), so this has to be the caller's number.
    const row = { id: "r0", team: "A", score: 1, label: "short" };
    const columns = [
      { id: "label", widthPx: 220, value: (entry: typeof row) => entry.label },
    ] as const;

    expect(estimateDomRowHeight(row, columns, 20)).toBe(20);
    // Same row, same columns, different base: the memo is keyed on the text
    // that drives a wrapped estimate, so a base change must not be served a
    // cached height from the previous density.
    expect(estimateDomRowHeight(row, columns, 56)).toBe(56);
  });

  test("retains calibrated wrapped-height estimates across column identities", () => {
    const prepareText = vi.spyOn(textCore, "prepareText");
    const row = {
      id: "S2-row-0",
      team: "A",
      score: 24.1,
      label:
        "Bonjour depuis Pretable token-231 Bonjour depuis Pretable token-232 Bonjour depuis Pretable token-233 Bonjour depuis Pretable token-234",
    };
    const columns = [
      {
        id: "label",
        wrap: true,
        widthPx: 220,
        value: (entry: Row) => entry.label,
      },
    ] as const;

    const first = estimateDomRowHeight(row, columns);
    const callsAfterFirst = prepareText.mock.calls.length;
    const second = estimateDomRowHeight(row, [...columns]);

    expect(first).toBeGreaterThan(44);
    expect(second).toBe(first);
    expect(prepareText).toHaveBeenCalledTimes(callsAfterFirst);
  });

  test("plans complete left, scrollable and right column regions with fallback widths", () => {
    const plan = planColumnLayout<Row>([
      { id: "a", header: "A", widthPx: 150 },
      { id: "b", header: "B", widthPx: 100, pinned: "left" },
      { id: "c", header: "C", wrap: true },
      { id: "d", header: "D", widthPx: 60, pinned: "left" },
      { id: "e", header: "E", widthPx: 80, pinned: "right" },
    ]);

    expect(plan.columns.map((column) => column.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
      "e",
    ]);
    expect(plan.columns.map((column) => column.left)).toEqual([
      0, 100, 160, 310, 530,
    ]);
    expect(plan.totalWidth).toBe(610);
    expect(plan.pinnedLeftWidth).toBe(160);
    expect(plan.pinnedRightWidth).toBe(80);
  });

  test("virtualizes horizontal columns while retaining both pinned regions", () => {
    const model = createModel([{ id: 1, team: "A", score: 1, label: "one" }]);
    const columns = [
      { id: "left", widthPx: 100, pinned: "left" as const },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `column-${index}`,
        widthPx: 140,
      })),
      { id: "right", widthPx: 80, pinned: "right" as const },
    ];
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
      scheduler,
      now: () => 0,
    });
    scheduler.flushAll();

    const render = createDomRenderSnapshot({
      controllerState: controller.getState(),
      columns,
      scrollLeft: 1_500,
      viewportWidth: 400,
    });

    expect(render.columns.length).toBeLessThan(columns.length);
    expect(render.columns[0]).toMatchObject({ id: "left", pinned: "left" });
    expect(render.columns.at(-1)).toMatchObject({
      id: "right",
      pinned: "right",
      right: 0,
    });
    expect(render.totalWidth).toBe(2_980);
    expect(render.pinnedLeftWidth).toBe(100);
    expect(render.pinnedRightWidth).toBe(80);
    expect(render.nodeCount).toBe(render.rows.length * render.columns.length);
    controller.dispose();
    model.dispose();
  });

  test("keeps controller row, ID, and column inference invariant", () => {
    if (false) {
      const literal = null as unknown as RowLayoutController<
        Row,
        1,
        typeof modelColumns
      >;
      const numeric = null as unknown as RowLayoutController<
        Row,
        number,
        typeof modelColumns
      >;
      literal.measure({ kind: "data", rowId: 1 }, 44);
      numeric.measure({ kind: "data", rowId: 2 }, 44);
      // @ts-expect-error A literal-ID controller cannot accept another ID.
      literal.measure({ kind: "data", rowId: 2 }, 44);
      // @ts-expect-error Controller generics are invariant from wide to narrow.
      const narrow: typeof literal = numeric;
      // @ts-expect-error Controller generics are invariant from narrow to wide.
      const wide: typeof numeric = literal;
      void narrow;
      void wide;
    }
    expect(true).toBe(true);
  });

  test("publishes a stable external-store state and projects only its planned range", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      id: index,
      team: "A",
      score: index,
      label: index === 2 ? "a long wrapped label ".repeat(12) : `row ${index}`,
    }));
    const sourceModel = createModel(rows);
    const rangeCalls: Array<readonly [number, number]> = [];
    const model = new Proxy(sourceModel, {
      get(target, property, receiver) {
        if (property !== "getState")
          return Reflect.get(target, property, receiver);
        return () => {
          const source = sourceModel.getState();
          const snapshot = source.snapshot;
          return {
            ...source,
            snapshot: Object.freeze({
              ...snapshot,
              range(start: number, end: number) {
                rangeCalls.push([start, end]);
                return snapshot.range(start, end);
              },
            }),
          };
        };
      },
    });
    const estimate = vi.fn((row: Row) => (row.id === 2 ? 180 : 44));
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 44, viewportHeight: 88, overscan: 1 },
      scheduler,
      estimateRowHeight: estimate,
      now: () => 0,
      maxUnitsPerSlice: 256,
    });
    const pending = controller.getState();
    expect(pending.status.kind).toBe("rebuilding");
    expect(pending.observedRevision).toBeNull();
    scheduler.flushAll();

    const state = controller.getState();
    expect(controller.getState()).toBe(state);
    expect(state.observedRevision).toBe(model.getState().snapshot.revision);
    expect(estimate.mock.calls.length).toBeLessThan(12);
    expect(estimate.mock.calls.length).toBeGreaterThan(0);
    expect(state.window.length).toBeLessThan(12);
    expect(rangeCalls.length).toBeLessThanOrEqual(2);
    expect(
      Math.max(...rangeCalls.map(([start, end]) => end - start)),
    ).toBeLessThan(12);

    rangeCalls.length = 0;
    const render = createDomRenderSnapshot({
      controllerState: state,
      columns: renderColumns,
      viewportWidth: 260,
    });
    expect(render.modelRevision).toBe(state.observedRevision);
    expect(render.rows.map((row) => row.rowIndex)).toEqual(
      state.window.map((row) => row.index),
    );
    expect(render.rows).toHaveLength(state.window.length);
    expect(render.rowMetrics).toBe(state.rowHeights);
    expect(rangeCalls).toEqual([]);
    const notifications = vi.fn();
    controller.subscribe(notifications);
    controller.setViewport(state.viewport);
    expect(controller.getState()).toBe(state);
    expect(notifications).not.toHaveBeenCalled();
  });

  test("estimates every row that enters the replanned published window", () => {
    const model = createModel(
      Array.from({ length: 8 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `row ${index}`,
      })),
    );
    const estimatedIds: Array<Row["id"]> = [];
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 88, viewportHeight: 44, overscan: 1 },
      scheduler,
      estimateRowHeight(row) {
        estimatedIds.push(row.id);
        if (row.id === 1) return 200;
        if (row.id === 0) return 100;
        if (row.id === 2) return 0.5;
        return 44;
      },
      now: () => 0,
    });
    scheduler.flushAll();
    const state = controller.getState();
    expect(state.window.map((entry) => entry.ref)).toContainEqual(data(0));
    expect(estimatedIds).toContain(0);
    expect(state.rowHeights.getHeight(0)).toBe(100);
    expect(state.rowHeights.getHeight(2)).toBe(44);
  });

  test("replays exact journals atomically, retains moves, and invalidates every update", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "B", score: 3, label: "three" },
    ]);
    const changesSince = vi.spyOn(model, "changesSince");
    const { controller } = createReadyController(model);
    controller.measure(data(2), 91);
    expect(controller.getState().rowHeights.hasMeasurement(data(2))).toBe(true);
    const before = controller.getState();

    model.applyTransaction({
      add: [{ id: 4, team: "A", score: 0, label: "four" }],
      remove: [1],
    });
    expect(changesSince).toHaveBeenLastCalledWith(before.observedRevision);
    const movedRank = model.getState().snapshot.indexOf(data(2));
    expect(controller.getState().rowHeights.getHeight(movedRank)).toBe(91);
    expect(controller.getState().rowHeights.hasMeasurement(data(2))).toBe(true);
    expect(controller.getState().observedRevision).toBe(
      model.getState().snapshot.revision,
    );

    model.applyTransaction({
      update: [{ id: 2, changes: { label: "changed" } }],
    });
    expect(controller.getState().rowHeights.hasMeasurement(data(2))).toBe(
      false,
    );
  });

  test("maps a canonical move without discarding its retained measurement", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "A", score: 3, label: "three" },
    ]);
    const { controller } = createReadyController(model);
    controller.measure(data(1), 83);
    const actualChangesSince = model.changesSince.bind(model);
    vi.spyOn(model, "changesSince").mockImplementation((revision) => {
      const sequence = actualChangesSince(revision);
      if (sequence.kind === "reset") return sequence;
      return {
        ...sequence,
        changes: sequence.changes.map((change) => ({
          ...change,
          operations: change.operations.filter(
            (operation) => operation.kind !== "update",
          ),
        })),
      };
    });
    model.applyTransaction({ update: [{ id: 1, changes: { score: 4 } }] });
    const rank = model.getState().snapshot.indexOf(data(1));
    expect(rank).toBe(2);
    expect(controller.getState().rowHeights.getHeight(rank)).toBe(83);
    expect(controller.getState().rowHeights.hasMeasurement(data(1))).toBe(true);
  });

  test("retains measured rows through collapse/reinsert and separates equal data/group text", () => {
    const model = createModel(
      [
        { id: "same", team: "same", score: 1, label: "data same" },
        { id: "other", team: "same", score: 2, label: "other" },
      ],
      { grouped: true },
    );
    const { controller } = createReadyController(model);
    const snapshot = model.getState().snapshot;
    const group = snapshot.rowAt(0);
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") throw new Error("Expected group row.");
    const groupRef = { kind: "group" as const, groupId: group.groupId };
    const dataRef = data("same");
    controller.measure(groupRef, 61);
    controller.measure(dataRef, 97);
    expect(controller.getState().rowHeights.hasMeasurement(groupRef)).toBe(
      true,
    );
    expect(controller.getState().rowHeights.hasMeasurement(dataRef)).toBe(true);

    model.setGroupExpanded(group.groupId, false);
    expect(controller.getState().rowHeights.hasMeasurement(dataRef)).toBe(true);
    model.setGroupExpanded(group.groupId, true);
    const restored = controller.getState();
    // The expansion journal updates the group row itself, so its measurement is
    // conservatively invalidated. The removed/reinserted data row keeps its own
    // independently keyed measurement.
    expect(
      restored.rowHeights.getHeight(restored.snapshot!.indexOf(groupRef)),
    ).toBe(44);
    expect(
      restored.rowHeights.getHeight(restored.snapshot!.indexOf(dataRef)),
    ).toBe(97);
  });

  test("cooperatively rebuilds reset barriers without exposing a partial root", () => {
    const initial = Array.from({ length: 100 }, (_, index) => ({
      id: index,
      team: "A",
      score: index,
      label: `old ${index}`,
    }));
    const model = createModel(initial, { journalCapacity: 0 });
    const { controller, scheduler } = createReadyController(model);
    const prior = controller.getState();
    const next = Array.from({ length: 100_000 }, (_, index) => ({
      id: index,
      team: "B",
      score: index,
      label: `new ${index}`,
    }));
    model.setRows(next);

    const rebuilding = controller.getState();
    expect(rebuilding.status.kind).toBe("rebuilding");
    expect(rebuilding.observedRevision).toBe(prior.observedRevision);
    expect(rebuilding.rowHeights).toBe(prior.rowHeights);
    scheduler.flushOne();
    expect(controller.getState().rowHeights).toBe(prior.rowHeights);
    scheduler.flushAll();

    const ready = controller.getState();
    expect(ready.status.kind).toBe("ready");
    expect(ready.observedRevision).toBe(model.getState().snapshot.revision);
    expect(ready.rowHeights.rowCount).toBe(100_000);
    const diagnostics = getRowLayoutControllerDiagnosticsForTesting(controller);
    expect(diagnostics.maxReplacementUnitsPerSlice).toBeLessThanOrEqual(256);
    expect(diagnostics.replacementSliceCount).toBeGreaterThan(1);
    expect(diagnostics.lastPublishedRangeRows).toBeLessThan(12);
  }, 30_000);

  test("finishes a 100k reset while an ordinary revision arrives after every slice", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    model.setRows(
      Array.from({ length: 100_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );

    let streamed = 0;
    while (streamed < 2_000 && controller.getState().status.kind !== "ready") {
      expect(flushNextLive(scheduler)).toBe(true);
      model.applyTransaction({
        update: [
          {
            id: streamed % 100,
            changes: { label: `stream ${streamed}` },
          },
        ],
      });
      streamed += 1;
      if (streamed === 100) {
        const retained = model.changesSince(1);
        expect(retained.kind).toBe("changes");
        if (retained.kind === "changes") {
          expect(retained.changes).toHaveLength(100);
        }
        const progressing =
          getRowLayoutControllerDiagnosticsForTesting(controller);
        expect(controller.getState()).toMatchObject({
          observedRevision: 0,
          status: { kind: "rebuilding", targetRevision: 101 },
        });
        expect(progressing.replacementStartCount).toBe(beforeStarts + 1);
        expect(progressing.pendingCatchUpChangeSetCount).toBe(100);
        expect(progressing.retainedCatchUpSnapshotCount).toBeGreaterThan(0);
      }
    }

    expect(streamed).toBeLessThan(2_000);
    expect(controller.getState()).toMatchObject({
      observedRevision: model.getState().snapshot.revision,
      status: { kind: "ready" },
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({
      replacementStartCount: beforeStarts + 1,
      pendingCatchUpChangeSetCount: 0,
      pendingCatchUpOperationCount: 0,
      retainedCatchUpSnapshotCount: 0,
      maxCatchUpUnitsPerSlice: 256,
    });
  }, 30_000);

  test("supersedes only at a later barrier and queues ordinary revisions after it", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `first ${index}`,
      })),
    );
    expect(flushNextLive(scheduler)).toBe(true);
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "queued before barrier" } }],
    });
    model.setRows(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: index,
        team: "C",
        score: index,
        label: `barrier ${index}`,
      })),
    );
    for (let revision = 0; revision < 50; revision += 1) {
      model.applyTransaction({
        update: [
          {
            id: revision,
            changes: { label: `after barrier ${revision}` },
          },
        ],
      });
    }
    const pending = getRowLayoutControllerDiagnosticsForTesting(controller);
    expect(pending.replacementStartCount).toBe(beforeStarts + 2);
    expect(pending.pendingCatchUpChangeSetCount).toBe(50);
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: model.getState().snapshot.revision,
      status: { kind: "ready" },
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({
      pendingCatchUpChangeSetCount: 0,
      retainedCatchUpSnapshotCount: 0,
    });
  });

  test("keeps transition catch-up independent from a capacity-one consumer journal", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
      { journalCapacity: 1 },
    );
    const { controller, scheduler } = createReadyController(model);
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    for (let revision = 0; revision < 50; revision += 1) {
      expect(flushNextLive(scheduler)).toBe(true);
      model.applyTransaction({
        update: [
          {
            id: revision,
            changes: { label: `stream ${revision}` },
          },
        ],
      });
    }
    expect(model.changesSince(1)).toMatchObject({
      kind: "reset",
      reason: "journal-evicted",
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({
      replacementStartCount: beforeStarts + 1,
      pendingCatchUpChangeSetCount: 50,
    });
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 51,
      status: { kind: "ready" },
    });
  });

  test("replays one large revision across bounded private slices", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    const published = controller.getState();
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    model.applyTransaction({
      update: Array.from({ length: 1_000 }, (_, id) => ({
        id,
        changes: { label: `updated ${id}` },
      })),
    });
    let slices = 0;
    while (
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .retainedCandidateRootCount === 0
    ) {
      expect(flushNextLive(scheduler)).toBe(true);
      slices += 1;
      if (slices > 1_000) throw new Error("Candidate did not finish.");
    }
    expect(controller.getState().rowHeights).toBe(published.rowHeights);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .pendingCatchUpOperationCount,
    ).toBeGreaterThan(0);
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      status: { kind: "ready" },
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .maxCatchUpUnitsPerSlice,
    ).toBeLessThanOrEqual(256);
  });

  test("falls back from a hostile queued change getter without partial publication", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    const published = controller.getState();
    const realChangesSince = model.changesSince.bind(model);
    vi.spyOn(model, "changesSince").mockImplementation((revision) => {
      const sequence = realChangesSince(revision);
      if (
        revision !== 1 ||
        sequence.kind !== "changes" ||
        sequence.changes.length === 0
      ) {
        return sequence;
      }
      const first = sequence.changes[0]!;
      const hostile = Object.defineProperty(
        {
          previousRevision: first.previousRevision,
          revision: first.revision,
        },
        "operations",
        {
          enumerable: true,
          get() {
            throw new Error("queued operations exploded");
          },
        },
      ) as unknown as PretableChangeSet<Row["id"]>;
      return { ...sequence, changes: [hostile] };
    });
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "latest" } }],
    });
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      status: { kind: "ready" },
    });
    expect(controller.getState().rowHeights).not.toBe(published.rowHeights);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .replacementStartCount,
    ).toBe(beforeStarts + 2);
  });

  test("does not regress when final anchor lookup publishes a newer revision reentrantly", () => {
    const source = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    let reenterOnIndex = false;
    let revisionOneIndexCalls = 0;
    const model = new Proxy(source, {
      get(target, property, receiver) {
        if (property !== "getState") {
          return Reflect.get(target, property, receiver);
        }
        return () => {
          const modelState = source.getState();
          const snapshot = modelState.snapshot;
          return {
            ...modelState,
            snapshot: Object.freeze({
              ...snapshot,
              indexOf(ref: PretableVisibleRowRef<Row["id"]>) {
                if (snapshot.revision === 1) revisionOneIndexCalls += 1;
                if (
                  reenterOnIndex &&
                  snapshot.revision === 1 &&
                  revisionOneIndexCalls === 2
                ) {
                  reenterOnIndex = false;
                  source.applyTransaction({
                    update: [{ id: 1, changes: { label: "reentrant latest" } }],
                  });
                }
                return snapshot.indexOf(ref);
              },
            }),
          };
        };
      },
    });
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 44, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    scheduler.flushAll();
    const revisions: number[] = [];
    controller.subscribe(() => {
      const revision = controller.getState().observedRevision;
      if (revision !== null) revisions.push(revision);
    });
    reenterOnIndex = true;
    source.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      status: { kind: "ready" },
    });
    expect(revisions).toEqual(
      [...revisions].sort((left, right) => left - right),
    );
    expect(revisions).not.toContain(1);
    expect(revisions.at(-1)).toBe(2);
  });

  test("contains a hostile active target revision getter and rebuilds its latest snapshot", () => {
    const source = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    let throwRevisionOnce = false;
    const model = new Proxy(source, {
      get(target, property, receiver) {
        if (property !== "getState") {
          return Reflect.get(target, property, receiver);
        }
        return () => {
          const modelState = source.getState();
          if (!throwRevisionOnce || modelState.snapshot.revision !== 2) {
            return modelState;
          }
          throwRevisionOnce = false;
          return {
            ...modelState,
            snapshot: Object.defineProperty(
              { ...modelState.snapshot },
              "revision",
              {
                enumerable: true,
                get() {
                  throw new Error("target revision exploded");
                },
              },
            ),
          } as typeof modelState;
        };
      },
    });
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    scheduler.flushAll();
    source.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    throwRevisionOnce = true;
    expect(() =>
      source.applyTransaction({
        update: [{ id: 1, changes: { label: "latest" } }],
      }),
    ).not.toThrow();
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      status: { kind: "ready" },
    });
  });

  test("clamps incremental and reset publications to the final scroll extent", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    controller.setViewport({
      scrollTop: 3_900,
      viewportHeight: 500,
      overscan: 0,
    });
    model.applyTransaction({
      remove: Array.from({ length: 11 }, (_, index) => 89 + index),
    });
    const shortened = controller.getState();
    const shortenedMaximum = Math.max(
      0,
      shortened.rowHeights.getTotalHeight() - 500,
    );
    expect(shortenedMaximum).toBeLessThan(3_900);
    expect(shortened.scrollTop).toBe(shortenedMaximum);
    expect(shortened.viewport.scrollTop).toBe(shortenedMaximum);
    expect(shortened.snapshot?.indexOf(data(88))).toBe(88);

    controller.setViewport({
      scrollTop: 100.25,
      viewportHeight: 500.5,
      overscan: 0,
    });
    model.setRows([{ id: 1, team: "B", score: 1, label: "short" }]);
    scheduler.flushAll();
    const short = controller.getState();
    expect(short.rowHeights.getTotalHeight()).toBeLessThan(500.5);
    expect(short.scrollTop).toBe(0);
    expect(short.viewport.scrollTop).toBe(0);

    model.setRows([]);
    scheduler.flushAll();
    const empty = controller.getState();
    expect(empty.rowHeights.getTotalHeight()).toBe(0);
    expect(empty.scrollTop).toBe(0);
    expect(empty.viewport.scrollTop).toBe(0);
    expect(empty.range).toEqual({ start: 0, end: 0 });
  });

  test("defers viewport publication during a reset until matching geometry is ready", () => {
    const model = createModel(
      Array.from({ length: 20 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const { controller, scheduler } = createReadyController(model);
    const notifications = vi.fn();
    controller.subscribe(notifications);
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `new ${index}`,
      })),
    );
    const rebuilding = controller.getState();
    notifications.mockClear();
    controller.setViewport({ scrollTop: 440, viewportHeight: 88, overscan: 1 });
    expect(controller.getState()).toBe(rebuilding);
    expect(notifications).not.toHaveBeenCalled();
    model.setRows(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: index,
        team: "C",
        score: index,
        label: `superseding ${index}`,
      })),
    );
    expect(controller.getState().viewport.scrollTop).toBe(0);
    expect(controller.getState().window).toBe(rebuilding.window);
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      scrollTop: 440,
      viewport: { scrollTop: 440 },
      status: { kind: "ready" },
    });
    expect(controller.getState().range.start).toBeGreaterThan(0);
  });

  test("rolls a deferred viewport back after reset failure so the same request can retry", () => {
    const model = createModel(
      Array.from({ length: 40 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    let failNextEstimate = false;
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      estimateRowHeight(row) {
        if (failNextEstimate && row.id === 10) {
          failNextEstimate = false;
          throw new Error("estimate exploded");
        }
        return 44;
      },
      now: () => 0,
    });
    scheduler.flushAll();
    failNextEstimate = true;
    model.setRows(
      Array.from({ length: 40 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `new ${index}`,
      })),
    );
    controller.measure(data(0), 123);
    controller.setViewport({ scrollTop: 440, viewportHeight: 88, overscan: 0 });
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      viewport: { scrollTop: 0 },
      status: { kind: "error" },
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .stagedMeasurementCount,
    ).toBe(0);

    controller.setViewport({ scrollTop: 440, viewportHeight: 88, overscan: 0 });
    expect(controller.getState()).toMatchObject({
      viewport: { scrollTop: 440 },
      status: { kind: "ready" },
    });
  });

  test("ignores a failing stale replacement after reentrant reset supersession", () => {
    const source = createModel(
      Array.from({ length: 300 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    let superseded = false;
    const model = new Proxy(source, {
      get(target, property, receiver) {
        if (property !== "getState") {
          return Reflect.get(target, property, receiver);
        }
        return () => {
          const modelState = source.getState();
          if (modelState.snapshot.revision !== 1) return modelState;
          const snapshot = modelState.snapshot;
          return {
            ...modelState,
            snapshot: Object.freeze({
              ...snapshot,
              rowAt(index: number) {
                if (!superseded) {
                  superseded = true;
                  source.setRows(
                    Array.from({ length: 301 }, (_, rowIndex) => ({
                      id: rowIndex,
                      team: "C",
                      score: rowIndex,
                      label: `latest ${rowIndex}`,
                    })),
                  );
                  throw new Error("stale source exploded");
                }
                return snapshot.rowAt(index);
              },
            }),
          };
        };
      },
    });
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    scheduler.flushAll();
    const statuses: string[] = [];
    controller.subscribe(() =>
      statuses.push(controller.getState().status.kind),
    );
    source.setRows(
      Array.from({ length: 300 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `intermediate ${index}`,
      })),
    );
    scheduler.flushAll();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      status: { kind: "ready" },
    });
    expect(statuses).not.toContain("error");
  });

  test("ignores a stale scheduler throw after reentrant measurement and reset supersession", () => {
    const model = createModel(
      Array.from({ length: 20 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `old ${index}`,
      })),
    );
    const queue = new ManualScheduler();
    let onSchedule: (() => void) | undefined;
    const scheduler: RowLayoutScheduler = {
      schedule(task) {
        const reenter = onSchedule;
        if (reenter !== undefined) {
          onSchedule = undefined;
          reenter();
          throw new Error("stale schedule exploded");
        }
        return queue.schedule(task);
      },
    };
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    queue.flushAll();
    const statuses: string[] = [];
    controller.subscribe(() =>
      statuses.push(controller.getState().status.kind),
    );
    model.setRows(
      Array.from({ length: 301 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `intermediate ${index}`,
      })),
    );
    onSchedule = () => {
      controller.setViewport({
        scrollTop: 440,
        viewportHeight: 88,
        overscan: 0,
      });
      controller.measure(data(1), 99);
      model.setRows(
        Array.from({ length: 302 }, (_, index) => ({
          id: index,
          team: "C",
          score: index,
          label: `latest ${index}`,
        })),
      );
    };
    expect(() => queue.flushOne()).not.toThrow();
    queue.flushAll();
    const settled = controller.getState();
    const rank = settled.snapshot!.indexOf(data(1));
    expect(settled).toMatchObject({
      observedRevision: 2,
      viewport: { scrollTop: 440 },
      status: { kind: "ready" },
    });
    expect(settled.rowHeights.getHeight(rank)).toBe(99);
    expect(statuses).not.toContain("error");
  });

  test("preserves a reset anchor by exact ref, ancestor, then logical neighbor", () => {
    const rows = [
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "A", score: 3, label: "three" },
      { id: 4, team: "B", score: 4, label: "four" },
    ];
    const model = createModel(rows);
    const { controller, scheduler } = createReadyController(model);
    controller.setViewport({ scrollTop: 49, viewportHeight: 88, overscan: 0 });
    model.setRows([{ id: 0, team: "A", score: 0, label: "zero" }, ...rows]);
    scheduler.flushAll();
    expect(controller.getState().scrollTop).toBe(93);

    controller.setViewport({ scrollTop: 93, viewportHeight: 88, overscan: 0 });
    model.setRows([
      { id: 0, team: "A", score: 0, label: "zero" },
      rows[0]!,
      rows[2]!,
      rows[3]!,
    ]);
    scheduler.flushAll();
    const neighborState = controller.getState();
    expect(neighborState.snapshot?.rowAt(2)).toMatchObject({ rowId: 3 });
    expect(neighborState.scrollTop).toBe(93);

    const grouped = createModel(rows, { grouped: true });
    const groupedReady = createReadyController(grouped);
    const groupedSnapshot = grouped.getState().snapshot;
    const anchoredData = data(2);
    const parent = groupedSnapshot.parentGroupOf(anchoredData);
    expect(parent).toBeDefined();
    groupedReady.controller.setViewport({
      scrollTop: groupedReady.controller
        .getState()
        .rowHeights.getOffsetForIndex(groupedSnapshot.indexOf(anchoredData)),
      viewportHeight: 88,
      overscan: 0,
    });
    grouped.setExpansionDefault({ kind: "collapsed" });
    groupedReady.scheduler.flushAll();
    expect(groupedReady.controller.getState().snapshot?.rowAt(0)).toMatchObject(
      {
        groupId: parent?.groupId,
      },
    );
    expect(groupedReady.controller.getState().scrollTop).toBe(0);
  });

  test("serializes reentrant notifications and never exposes mismatched revisions", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller } = createReadyController(model);
    const revisions: number[] = [];
    const secondSubscriberRevisions: number[] = [];
    let reentered = false;
    controller.subscribe(() => {
      const state = controller.getState();
      if (state.status.kind !== "ready" || state.observedRevision === null)
        return;
      expect(state.snapshot?.revision).toBe(state.observedRevision);
      revisions.push(state.observedRevision);
      if (!reentered) {
        reentered = true;
        model.applyTransaction({
          add: [{ id: 3, team: "B", score: 3, label: "three" }],
        });
      }
    });
    controller.subscribe(() => {
      const revision = controller.getState().observedRevision;
      if (revision !== null) secondSubscriberRevisions.push(revision);
    });
    model.applyTransaction({
      add: [{ id: 0, team: "A", score: 0, label: "zero" }],
    });
    expect(revisions).toEqual([1, 2]);
    expect(secondSubscriberRevisions).toEqual([1, 2]);
    expect(controller.getState().observedRevision).toBe(2);
  });

  test("serializes reentrant column changes and no-ops unchanged columns", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller, scheduler } = createReadyController(model);
    const widerColumns = [
      { ...renderColumns[0], widthPx: 120 },
      renderColumns[1],
    ] as const;
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    let changed = false;
    let notifyingFirstListener = false;
    let nestedNotification = false;
    controller.subscribe(() => {
      if (changed) return;
      changed = true;
      notifyingFirstListener = true;
      controller.setColumns(widerColumns);
      notifyingFirstListener = false;
    });
    controller.subscribe(() => {
      if (notifyingFirstListener) nestedNotification = true;
    });

    model.applyTransaction({
      update: [{ id: 1, changes: { label: "one updated" } }],
    });
    scheduler.flushAll();

    expect(changed).toBe(true);
    expect(nestedNotification).toBe(false);
    expect(controller.getState().status.kind).toBe("ready");
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .replacementStartCount,
    ).toBe(beforeStarts + 1);

    controller.setColumns([{ ...widerColumns[0] }, { ...widerColumns[1] }]);
    scheduler.flushAll();
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .replacementStartCount,
    ).toBe(beforeStarts + 1);
  });

  test("queues model reentrancy that starts during an atomic reset publication", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller, scheduler } = createReadyController(model);
    const first: number[] = [];
    const second: number[] = [];
    let reentered = false;
    controller.subscribe(() => {
      const revision = controller.getState().observedRevision;
      if (revision === null) return;
      first.push(revision);
      if (!reentered && controller.getState().status.kind === "ready") {
        reentered = true;
        model.applyTransaction({
          add: [{ id: 3, team: "B", score: 3, label: "three" }],
        });
      }
    });
    controller.subscribe(() => {
      const revision = controller.getState().observedRevision;
      if (revision !== null) second.push(revision);
    });
    model.setRows([
      { id: 1, team: "A", score: 1, label: "one reset" },
      { id: 2, team: "A", score: 2, label: "two reset" },
    ]);
    scheduler.flushAll();
    expect(first).toEqual([0, 1, 2]);
    expect(second).toEqual([0, 1, 2]);
    expect(controller.getState().observedRevision).toBe(2);
  });

  test("serializes listener-triggered viewport, measurement, and disposal publications", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "A", score: 3, label: "three" },
    ]);
    const { controller } = createReadyController(model);
    const initialHeight = controller.getState().rowHeights.getHeight(0);
    const first: string[] = [];
    const second: string[] = [];
    let phase = 0;
    let attemptedInvalidMeasurement = false;
    const signature = () => {
      const state = controller.getState();
      const rank = state.snapshot?.indexOf(data(1)) ?? -1;
      const height = rank < 0 ? -1 : state.rowHeights.getHeight(rank);
      return `${state.status.kind}:${state.viewport.scrollTop}:${height}`;
    };
    controller.subscribe(() => {
      if (attemptedInvalidMeasurement) return;
      attemptedInvalidMeasurement = true;
      controller.measure(data(1), Number.NaN);
    });
    controller.subscribe(() => {
      first.push(signature());
      if (phase === 0) {
        phase = 1;
        controller.setViewport({
          scrollTop: 44,
          viewportHeight: 88,
          overscan: 1,
        });
      } else if (phase === 1) {
        phase = 2;
        controller.measure(data(1), 70);
      } else if (phase === 2) {
        phase = 3;
        controller.dispose();
      }
    });
    controller.subscribe(() => second.push(signature()));
    model.applyTransaction({
      update: [{ id: 3, changes: { label: "changed" } }],
    });
    expect(first).toEqual([
      `ready:0:${initialHeight}`,
      `ready:44:${initialHeight}`,
      "ready:44:70",
      "disposed:44:70",
    ]);
    expect(second).toEqual(first);
  });

  test("isolates a queued command invalidated by model catch-up and continues FIFO actions", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "A", score: 3, label: "three" },
    ]);
    const { controller } = createReadyController(model);
    let queuedMeasurement = false;
    let removedMeasuredRow = false;
    let queuedViewport = false;
    controller.subscribe(() => {
      if (queuedMeasurement) return;
      queuedMeasurement = true;
      controller.measure(data(1), 70);
    });
    controller.subscribe(() => {
      if (removedMeasuredRow) return;
      removedMeasuredRow = true;
      model.applyTransaction({ remove: [1] });
    });
    controller.subscribe(() => {
      if (queuedViewport) return;
      queuedViewport = true;
      controller.setViewport({
        scrollTop: 44,
        viewportHeight: 88,
        overscan: 1,
      });
    });
    expect(() =>
      model.applyTransaction({
        update: [{ id: 3, changes: { label: "changed" } }],
      }),
    ).not.toThrow();
    expect(controller.getState()).toMatchObject({
      observedRevision: 2,
      viewport: { scrollTop: 44 },
      status: { kind: "ready" },
    });
  });

  test("falls back from hostile journals and settles hostile scheduling/cancellation", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const scheduler = new ManualScheduler(new Error("cancel exploded"));
    const { controller } = createReadyController(model, scheduler);
    const realChangesSince = model.changesSince.bind(model);
    vi.spyOn(model, "changesSince").mockImplementation((revision) => {
      const actual = realChangesSince(revision);
      if (actual.kind === "reset") return actual;
      return { ...actual, toRevision: actual.toRevision + 1 };
    });
    model.applyTransaction({
      add: [{ id: 3, team: "B", score: 3, label: "three" }],
    });
    expect(controller.getState().status.kind).toBe("rebuilding");
    model.setRows([
      { id: 4, team: "C", score: 4, label: "four" },
      { id: 5, team: "C", score: 5, label: "five" },
    ]);
    expect(() => scheduler.flushAll()).not.toThrow();
    expect(controller.getState()).toMatchObject({
      observedRevision: model.getState().snapshot.revision,
      status: { kind: "ready" },
    });

    const throwingScheduler: RowLayoutScheduler = {
      schedule() {
        throw new Error("schedule exploded");
      },
    };
    const failed = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler: throwingScheduler,
    });
    expect(failed.getState().status).toMatchObject({ kind: "error" });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(failed).retainedBuilderCount,
    ).toBe(0);
  });

  test.each(["kind", "fromRevision", "changes", "operation"] as const)(
    "recovers atomically when a hostile journal %s getter throws",
    (failurePoint) => {
      const model = createModel([
        { id: 1, team: "A", score: 1, label: "one" },
        { id: 2, team: "A", score: 2, label: "two" },
      ]);
      const { controller, scheduler } = createReadyController(model);
      const before = controller.getState();
      const actualChangesSince = model.changesSince.bind(model);
      vi.spyOn(model, "changesSince").mockImplementation((revision) => {
        const actual = actualChangesSince(revision);
        if (actual.kind === "reset") return actual;
        const explode = () => {
          throw new Error(`hostile ${failurePoint}`);
        };
        if (failurePoint === "kind") {
          return Object.defineProperty({}, "kind", {
            enumerable: true,
            get: explode,
          }) as typeof actual;
        }
        if (failurePoint === "fromRevision") {
          return Object.defineProperty({ ...actual }, "fromRevision", {
            enumerable: true,
            get: explode,
          }) as typeof actual;
        }
        if (failurePoint === "changes") {
          return Object.defineProperty({ ...actual }, "changes", {
            enumerable: true,
            get: explode,
          }) as unknown as typeof actual;
        }
        const first = actual.changes[0]!;
        const operation = Object.defineProperty({}, "kind", {
          enumerable: true,
          get: explode,
        });
        return {
          ...actual,
          changes: [
            {
              ...first,
              operations: [operation] as unknown as typeof first.operations,
            },
          ],
        };
      });
      expect(() =>
        model.applyTransaction({
          add: [{ id: 3, team: "B", score: 3, label: "three" }],
        }),
      ).not.toThrow();
      expect(controller.getState().status.kind).toBe("rebuilding");
      expect(controller.getState().observedRevision).toBe(
        before.observedRevision,
      );
      expect(controller.getState().rowHeights).toBe(before.rowHeights);
      scheduler.flushAll();
      expect(controller.getState()).toMatchObject({
        observedRevision: model.getState().snapshot.revision,
        status: { kind: "ready" },
      });
    },
  );

  test("stages reset-time measurements through removal and reset supersession", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller, scheduler } = createReadyController(model);
    const before = controller.getState();
    model.setRows([{ id: 2, team: "B", score: 2, label: "two reset" }]);
    const startsAfterReset =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    controller.measure(data(1), 91);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .replacementStartCount,
    ).toBe(startsAfterReset);
    expect(controller.getState().rowHeights).toBe(before.rowHeights);
    model.setRows([
      { id: 2, team: "C", score: 2, label: "two superseded" },
      { id: 1, team: "C", score: 3, label: "one superseded" },
    ]);
    scheduler.flushAll();
    const restored = controller.getState();
    const rank = restored.snapshot!.indexOf(data(1));
    expect(restored.rowHeights.getHeight(rank)).toBe(91);
    expect(restored.rowHeights.hasMeasurement(data(1))).toBe(true);
  });

  test("keeps an applied reset measurement alive when a later barrier discards the candidate", () => {
    const rows = (count: number, label: string): readonly Row[] =>
      Array.from({ length: count }, (_, index) => ({
        id: index,
        team: label,
        score: index,
        label: `${label} ${index}`,
      }));
    const model = createModel(rows(100, "initial"));
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
      scheduler,
      now: () => 0,
      budgetMs: 5,
      maxUnitsPerSlice: 1,
    });
    scheduler.flushAll();

    model.setRows(rows(1_000, "first reset"));
    controller.measure(data(1), 99);
    const catchUpBefore =
      getRowLayoutControllerDiagnosticsForTesting(controller).catchUpUnits;
    let slices = 0;
    while (
      getRowLayoutControllerDiagnosticsForTesting(controller).catchUpUnits ===
      catchUpBefore
    ) {
      expect(flushNextLive(scheduler)).toBe(true);
      slices += 1;
      expect(slices).toBeLessThan(20_000);
    }
    expect(controller.getState().status.kind).toBe("rebuilding");
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .retainedCandidateRootCount,
    ).toBe(1);

    model.setRows(rows(1_001, "superseding reset"));
    scheduler.flushAll();
    const ready = controller.getState();
    const index = ready.snapshot!.indexOf(data(1));
    expect(ready.rowHeights.getHeight(index)).toBe(99);
    expect(ready.rowHeights.hasMeasurement(data(1))).toBe(true);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .stagedMeasurementCount,
    ).toBe(0);
  });

  test("orders repeated reset barriers, updates, and later measurements", () => {
    const rows = (count: number, label: string): readonly Row[] =>
      Array.from({ length: count }, (_, index) => ({
        id: index,
        team: label,
        score: index,
        label: `${label} ${index}`,
      }));
    const model = createModel(rows(10, "initial"));
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
      scheduler,
      now: () => 0,
      budgetMs: 5,
      maxUnitsPerSlice: 1,
    });
    scheduler.flushAll();

    model.setRows(rows(100, "first reset"));
    controller.measure(data(1), 71);
    const firstCatchUp =
      getRowLayoutControllerDiagnosticsForTesting(controller).catchUpUnits;
    while (
      getRowLayoutControllerDiagnosticsForTesting(controller).catchUpUnits ===
      firstCatchUp
    ) {
      expect(flushNextLive(scheduler)).toBe(true);
    }
    model.setRows(rows(101, "first barrier"));
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "updated after measurement" } }],
    });
    controller.measure(data(1), 137);
    model.setRows(rows(102, "second barrier"));
    scheduler.flushAll();

    const ready = controller.getState();
    const index = ready.snapshot!.indexOf(data(1));
    expect(ready.rowHeights.getHeight(index)).toBe(137);
    expect(ready.rowHeights.hasMeasurement(data(1))).toBe(true);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .stagedMeasurementCount,
    ).toBe(0);
  });

  test("keeps a measurement captured after an update that is still queued for replay", () => {
    const rows = (count: number, label: string): readonly Row[] =>
      Array.from({ length: count }, (_, index) => ({
        id: index,
        team: label,
        score: index,
        label: `${label} ${index}`,
      }));
    const model = createModel(rows(10, "initial"));
    const scheduler = new ManualScheduler();
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
      scheduler,
      now: () => 0,
      budgetMs: 5,
      maxUnitsPerSlice: 1,
    });
    scheduler.flushAll();

    model.setRows(rows(100, "reset"));
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "queued update" } }],
    });
    controller.measure(data(1), 137);
    scheduler.flushAll();

    const ready = controller.getState();
    const index = ready.snapshot!.indexOf(data(1));
    expect(ready.rowHeights.getHeight(index)).toBe(137);
    expect(ready.rowHeights.hasMeasurement(data(1))).toBe(true);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .stagedMeasurementCount,
    ).toBe(0);
  });

  test("invalidates an old-DOM reset measurement on a later exact row update", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller, scheduler } = createReadyController(model);
    const beforeStarts =
      getRowLayoutControllerDiagnosticsForTesting(
        controller,
      ).replacementStartCount;
    model.setRows([
      { id: 1, team: "B", score: 1, label: "one reset" },
      { id: 2, team: "B", score: 2, label: "two reset" },
    ]);
    controller.measure(data(1), 99);
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "one updated later" } }],
    });
    scheduler.flushAll();
    const ready = controller.getState();
    const index = ready.snapshot!.indexOf(data(1));
    expect(ready.rowHeights.getHeight(index)).not.toBe(99);
    expect(ready.rowHeights.hasMeasurement(data(1))).toBe(false);
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .replacementStartCount,
    ).toBe(beforeStarts + 1);
  });

  test("releases queued catch-up roots and staged measurements on disposal", () => {
    const model = createModel(
      Array.from({ length: 100 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `${index}`,
      })),
    );
    const { controller } = createReadyController(model);
    model.setRows(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: index,
        team: "B",
        score: index,
        label: `reset ${index}`,
      })),
    );
    controller.measure(data(1), 88);
    for (let revision = 0; revision < 3; revision += 1) {
      model.applyTransaction({
        update: [
          { id: 2 + revision, changes: { label: `queued ${revision}` } },
        ],
      });
    }
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({
      pendingCatchUpChangeSetCount: 3,
      stagedMeasurementCount: 1,
    });
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller)
        .retainedCatchUpSnapshotCount,
    ).toBeGreaterThan(0);
    controller.dispose();
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({
      scheduledCallbackCount: 0,
      retainedBuilderCount: 0,
      retainedCandidateRootCount: 0,
      pendingCatchUpChangeSetCount: 0,
      pendingCatchUpOperationCount: 0,
      retainedCatchUpSnapshotCount: 0,
      stagedMeasurementCount: 0,
    });
  });

  test("retains a reset-time measurement when the row is removed then inserted later", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller, scheduler } = createReadyController(model);
    model.setRows([{ id: 2, team: "B", score: 2, label: "two reset" }]);
    controller.measure(data(1), 93);
    scheduler.flushAll();
    expect(controller.getState().snapshot!.indexOf(data(1))).toBe(-1);
    model.applyTransaction({
      add: [{ id: 1, team: "B", score: 3, label: "one reinserted" }],
    });
    const inserted = controller.getState();
    const rank = inserted.snapshot!.indexOf(data(1));
    expect(inserted.rowHeights.getHeight(rank)).toBe(93);
    expect(inserted.rowHeights.hasMeasurement(data(1))).toBe(true);
  });

  test("initializes safely when subscribe notifies synchronously or cleanup throws", () => {
    const disposedModel = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
    ]);
    disposedModel.dispose();
    const detached = vi.fn();
    const synchronousDisposedModel = new Proxy(disposedModel, {
      get(target, property, receiver) {
        if (property !== "subscribe")
          return Reflect.get(target, property, receiver);
        return (listener: () => void) => {
          listener();
          return detached;
        };
      },
    });
    const disposedController = createRowLayoutController({
      model: synchronousDisposedModel,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
    });
    expect(disposedController.getState().status.kind).toBe("disposed");
    expect(detached).toHaveBeenCalledTimes(1);

    const readyModel = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
    ]);
    const throwingCleanupModel = new Proxy(readyModel, {
      get(target, property, receiver) {
        if (property !== "subscribe")
          return Reflect.get(target, property, receiver);
        return (listener: () => void) => {
          listener();
          return () => {
            throw new Error("unsubscribe exploded");
          };
        };
      },
    });
    const scheduler = new ManualScheduler();
    const cleanupController = createRowLayoutController({
      model: throwingCleanupModel,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    scheduler.flushAll();
    expect(() => cleanupController.dispose()).not.toThrow();
    expect(cleanupController.getState().status.kind).toBe("disposed");
  });

  test("releases synchronous subscription work when subscribe throws", () => {
    const model = createModel([{ id: 1, team: "A", score: 1, label: "one" }]);
    const scheduler = new ManualScheduler();
    const failure = new Error("subscribe exploded");
    const hostileModel = new Proxy(model, {
      get(target, property, receiver) {
        if (property !== "subscribe")
          return Reflect.get(target, property, receiver);
        return (listener: () => void) => {
          listener();
          throw failure;
        };
      },
    });
    expect(() =>
      createRowLayoutController({
        model: hostileModel,
        columns: renderColumns,
        viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
        scheduler,
        now: () => 0,
      }),
    ).toThrow(failure);
    expect(scheduler.tasks.every((entry) => entry.cancelled)).toBe(true);
    expect(() => scheduler.flushAll()).not.toThrow();
  });

  test("disposal cancels private candidates and stale scheduled work is inert", () => {
    const model = createModel(
      Array.from({ length: 5_000 }, (_, index) => ({
        id: index,
        team: "A",
        score: index,
        label: `${index}`,
      })),
    );
    const scheduler = new ManualScheduler(new Error("cancel exploded"));
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      now: () => 0,
    });
    const stale = scheduler.tasks[0]?.task;
    const notifications = vi.fn();
    controller.subscribe(notifications);
    expect(() => controller.dispose()).not.toThrow();
    expect(notifications).toHaveBeenCalledTimes(1);
    expect(controller.getState().status.kind).toBe("disposed");
    expect(
      getRowLayoutControllerDiagnosticsForTesting(controller),
    ).toMatchObject({ retainedBuilderCount: 0, scheduledCallbackCount: 0 });
    expect(() => stale?.()).not.toThrow();
    expect(controller.getState().status.kind).toBe("disposed");
  });

  test("captures the initial model snapshot once and tolerates synchronous scheduler callbacks", () => {
    vi.useFakeTimers();
    try {
      const model = createModel([
        { id: 1, team: "A", score: 1, label: "one" },
        { id: 2, team: "A", score: 2, label: "two" },
      ]);
      const captured = model.getState();
      const getState = vi.fn(() => captured);
      const trackedModel = new Proxy(model, {
        get(target, property, receiver) {
          return property === "getState"
            ? getState
            : Reflect.get(target, property, receiver);
        },
      });
      const synchronousScheduler: RowLayoutScheduler = {
        schedule(task) {
          task();
          return () => undefined;
        },
      };
      const controller = createRowLayoutController({
        model: trackedModel,
        columns: renderColumns,
        viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
        scheduler: synchronousScheduler,
        now: () => 0,
      });
      expect(getState).toHaveBeenCalledTimes(1);
      expect(controller.getState().status.kind).toBe("rebuilding");
      vi.runAllTimers();
      expect(controller.getState()).toMatchObject({
        observedRevision: captured.snapshot.revision,
        status: { kind: "ready" },
      });
      expect(getState).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("rolls back estimator failures and catches up on a later valid revision", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const scheduler = new ManualScheduler();
    const estimate = vi.fn((row: Row) => {
      if (row.label === "explode") throw new Error("estimate exploded");
      return 44;
    });
    const controller = createRowLayoutController({
      model,
      columns: renderColumns,
      viewport: { scrollTop: 0, viewportHeight: 88, overscan: 0 },
      scheduler,
      estimateRowHeight: estimate,
      now: () => 0,
    });
    scheduler.flushAll();
    const before = controller.getState();
    model.applyTransaction({
      update: [{ id: 1, changes: { label: "explode" } }],
    });
    scheduler.flushAll();
    expect(controller.getState().status.kind).toBe("error");
    expect(controller.getState().observedRevision).toBe(
      before.observedRevision,
    );
    expect(controller.getState().rowHeights).toBe(before.rowHeights);

    model.applyTransaction({
      update: [{ id: 1, changes: { label: "recovered" } }],
    });
    expect(controller.getState()).toMatchObject({
      observedRevision: model.getState().snapshot.revision,
      status: { kind: "ready" },
    });
  });

  describe("the default scheduler's fallback ladder", () => {
    // A chunked layout build schedules each slice from inside the previous one,
    // so `setTimeout(task, 0)` is a NESTED zero-delay timer and every browser
    // clamps those to ~4ms. Paid per slice with nothing painted, that clamp
    // cost 263ms to first cell on the 2,500 x 500 showcase in WebKit — which
    // has no `scheduler.postTask` and so always lands on the fallback — against
    // 13ms in Chromium, which has one. `MessageChannel` is an unclamped
    // macrotask, so it must be preferred wherever `postTask` is absent.
    //
    // Asserted on the host primitives rather than on elapsed time: the defect
    // is which primitive gets used, and a wall-clock assertion here would be a
    // flaky restatement of it.
    function scheduleOnDefault(): {
      messageChannels: number;
      zeroTimers: number;
    } {
      const model = createModel([
        { id: 1, team: "A", score: 1, label: "one" },
        { id: 2, team: "A", score: 2, label: "two" },
      ]);
      let messageChannels = 0;
      let zeroTimers = 0;
      const RealMessageChannel = globalThis.MessageChannel;
      const realSetTimeout = globalThis.setTimeout;
      globalThis.MessageChannel = class extends RealMessageChannel {
        constructor() {
          super();
          messageChannels += 1;
        }
      } as typeof MessageChannel;
      const timeoutSpy = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(((handler: TimerHandler, ms?: number) => {
          if (ms === undefined || ms === 0) zeroTimers += 1;
          return realSetTimeout(handler, ms);
        }) as never);
      try {
        // No `scheduler` option: this is the path a real consumer takes.
        const controller = createRowLayoutController({
          model,
          columns: renderColumns,
          viewport: { scrollTop: 0, viewportHeight: 88, overscan: 1 },
          now: () => 0,
          budgetMs: 5,
          maxUnitsPerSlice: 1, // force it to yield rather than finish in one slice
        });
        controller.dispose();
      } finally {
        globalThis.MessageChannel = RealMessageChannel;
        timeoutSpy.mockRestore();
      }
      return { messageChannels, zeroTimers };
    }

    test("prefers MessageChannel over a clamped zero-delay timer", () => {
      const hostScheduler = Reflect.get(globalThis as object, "scheduler");
      // Force the no-postTask world every Safari is in.
      Reflect.deleteProperty(globalThis as object, "scheduler");
      try {
        const used = scheduleOnDefault();
        expect(used.messageChannels).toBeGreaterThan(0);
        expect(used.zeroTimers).toBe(0);
      } finally {
        if (hostScheduler !== undefined) {
          Object.defineProperty(globalThis, "scheduler", {
            value: hostScheduler,
            configurable: true,
            writable: true,
          });
        }
      }
    });
  });

  test("rejects measurement ref/index mismatches without changing state", () => {
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
    ]);
    const { controller } = createReadyController(model);
    const before = controller.getState();
    expect(() =>
      controller.measure(
        { kind: "group", groupId: "1" as PretableGroupId },
        90,
      ),
    ).toThrow();
    expect(controller.getState()).toBe(before);
  });
});
