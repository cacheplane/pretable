import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  PretableDisposedModelError,
  type PretableAggregator,
  type PretableGroupId,
} from "../index";
import {
  getCooperativeTransitionCandidateDiagnosticsForTesting,
  type CooperativeTransitionScheduler,
} from "../cooperative-transition";
import {
  getLocalRowModelActiveTransitionCandidateForTesting,
  getLocalRowModelRevisionCauseForTesting,
} from "../create-local-row-model";

interface Row {
  id: number;
  team: string;
  score: number;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
] as const;

interface ScheduledEntry {
  readonly task: () => void;
  cancelled: boolean;
}

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: ScheduledEntry[] = [];
  maxWorkPerTask = 0;
  private workCounter: (() => number) | undefined;

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  observeWork(read: () => number): void {
    this.workCounter = read;
  }

  flushOne(options: { readonly includeCancelled?: boolean } = {}): boolean {
    const entry = this.entries.shift();
    if (entry === undefined) return false;
    const before = this.workCounter?.() ?? 0;
    if (!entry.cancelled || options.includeCancelled === true) entry.task();
    const after = this.workCounter?.() ?? before;
    this.maxWorkPerTask = Math.max(this.maxWorkPerTask, after - before);
    return true;
  }

  flushAll(limit = 1_000_000): void {
    let count = 0;
    while (this.flushOne()) {
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

function tickingClock() {
  let tick = 0;
  return () => tick++;
}

function rowIds(model: ReturnType<typeof createModel>) {
  return model
    .getState()
    .snapshot.range(0, Number.MAX_SAFE_INTEGER)
    .flatMap((row) => (row.kind === "data" ? [row.rowId] : []));
}

function createModel(options: {
  readonly rows?: readonly Row[];
  readonly scheduler?: ManualScheduler;
  readonly budgetMs?: number;
  readonly clock?: () => number;
}) {
  return createLocalRowModel({
    rows:
      options.rows ??
      Array.from({ length: 12 }, (_, id) => ({
        id,
        team: id % 2 === 0 ? "A" : "B",
        score: id,
      })),
    columns,
    transitionScheduler: options.scheduler,
    transitionClock: options.clock,
    transitionBudgetMs: options.budgetMs,
  });
}

describe("cooperative query and derivation transitions", () => {
  test("internally observes an unawaited transition rejected by automatic supersession", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: 2 }],
        sort: [],
        rowGroups: [],
      });
      const replacement = model.setDerivations([
        columns[0],
        { ...columns[1], aggregate: "avg" as const },
      ]);
      scheduler.flushAll();
      await replacement.finished;
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("falls back after postTask rejects before running and completes the transition", async () => {
    const postTaskFailure = new Error("postTask unavailable");
    const postTask = vi.fn(() => Promise.reject(postTaskFailure));
    vi.stubGlobal("scheduler", { postTask });
    let model: ReturnType<typeof createModel> | undefined;
    try {
      model = createModel({ clock: tickingClock(), budgetMs: 1 });
      const transition = model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: 2 }],
        sort: [],
        rowGroups: [],
      });
      const outcome = await Promise.race([
        transition.finished,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 100),
        ),
      ]);

      expect(outcome).toBe(1);
      expect(postTask).toHaveBeenCalled();
      expect(model.getState().status).toEqual({ kind: "ready" });
    } finally {
      model?.dispose();
      vi.unstubAllGlobals();
    }
  });

  test("falls through a broken MessageChannel to the timer scheduler", async () => {
    const postTask = vi.fn(() => Promise.reject(new Error("postTask failed")));
    vi.stubGlobal("scheduler", { postTask });
    vi.stubGlobal(
      "MessageChannel",
      class BrokenMessageChannel {
        constructor() {
          throw new Error("MessageChannel failed");
        }
      },
    );
    let model: ReturnType<typeof createModel> | undefined;
    try {
      model = createModel({ clock: tickingClock(), budgetMs: 1 });
      const transition = model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: 2 }],
        sort: [],
        rowGroups: [],
      });
      const outcome = await Promise.race([
        transition.finished,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 100),
        ),
      ]);

      expect(outcome).toBe(1);
      expect(model.getState().status).toEqual({ kind: "ready" });
    } finally {
      model?.dispose();
      vi.unstubAllGlobals();
    }
  });

  test("does not run a postTask fallback after cancellation wins the rejection race", async () => {
    const postTask = vi.fn(() => Promise.reject(new Error("postTask failed")));
    vi.stubGlobal("scheduler", { postTask });
    let evaluations = 0;
    const cancelColumns = [
      columns[0],
      {
        ...columns[1],
        accessor: (row: Row) => {
          evaluations += 1;
          return row.score;
        },
        value: (row: Row) => row.score,
      },
    ] as const;
    const model = createLocalRowModel({
      rows: Array.from({ length: 100 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      columns,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    try {
      const transition = model.setDerivations(cancelColumns);
      const rejection = expect(transition.finished).rejects.toMatchObject({
        reason: "cancelled",
      });
      const afterInitialSlice = evaluations;

      transition.cancel();

      await rejection;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(evaluations).toBe(afterInitialSlice);
      expect(model.getState().status).toEqual({ kind: "ready" });
    } finally {
      model.dispose();
      vi.unstubAllGlobals();
    }
  });

  test("yields after a bounded number of units when the injected clock never advances", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      rows: Array.from({ length: 1_000 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      scheduler,
      clock: () => 0,
      budgetMs: 5,
    });

    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 0 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });

    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      completedRows: 256,
      totalRows: 1_000,
    });
    expect(scheduler.entries).toHaveLength(1);
    scheduler.flushAll();
    await expect(transition.finished).resolves.toBe(1);
  });

  test("records the exact query or derivation operation as the atomic revision cause", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 2,
    });

    const queryTransition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 4 }],
      sort: [],
      rowGroups: [],
    });
    scheduler.flushAll();
    await queryTransition.finished;
    expect(getLocalRowModelRevisionCauseForTesting(model)).toEqual({
      kind: "set-query",
    });

    const derivationTransition = model.setDerivations([
      columns[0],
      { ...columns[1], aggregate: "avg" as const },
    ]);
    scheduler.flushAll();
    await derivationTransition.finished;
    expect(getLocalRowModelRevisionCauseForTesting(model)).toEqual({
      kind: "set-derivations",
    });
  });

  test.each([
    ["cancel", "cancelled"],
    ["dispose", "disposed"],
  ] as const)(
    "%s releases every candidate-held root, plan, index, iterator, and delta reference",
    async (action, reason) => {
      const scheduler = new ManualScheduler();
      const model = createModel({
        scheduler,
        clock: tickingClock(),
        budgetMs: 1,
      });
      const transition = model.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      });
      const rejection = expect(transition.finished).rejects.toMatchObject({
        reason,
      });
      model.applyTransaction({
        update: [{ id: 11, changes: { score: 111 } }],
      });
      const candidate =
        getLocalRowModelActiveTransitionCandidateForTesting(model);
      const stale = scheduler.entries[0];
      expect(candidate).toBeDefined();
      if (candidate === undefined) return;
      expect(
        getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
      ).toMatchObject({
        released: false,
        hasCapturedRoot: true,
        hasQueryPlan: true,
        hasIterator: true,
        deltaCount: 1,
        hasRows: true,
        hasSourceOrder: true,
        hasExpansion: true,
        hasFlatRows: true,
        hasGroups: true,
      });

      if (action === "cancel") transition.cancel();
      else model.dispose();

      await rejection;
      const released = {
        released: true,
        hasCapturedRoot: false,
        hasQueryPlan: false,
        hasIterator: false,
        deltaCount: 0,
        hasRows: false,
        hasSourceOrder: false,
        hasExpansion: false,
        hasFlatRows: false,
        hasGroups: false,
        deltaSlotCount: 0,
        processedDeltaCount: 0,
        retainedDeltaRootCount: 0,
        overrideReconciliationRemaining: 0,
      };
      expect(
        getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
      ).toEqual(released);
      stale?.task();
      expect(
        getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
      ).toEqual(released);
    },
  );

  test("drops each processed delta root while later journal targets remain queued", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const transition = model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    const finished = transition.finished.catch((error: unknown) => error);
    model.applyTransaction({
      update: [{ id: 1, changes: { score: 101 } }],
    });
    model.applyTransaction({
      update: [{ id: 2, changes: { score: 102 } }],
    });
    const candidate =
      getLocalRowModelActiveTransitionCandidateForTesting(model);
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;

    for (let index = 0; index < 13; index += 1) scheduler.flushOne();

    expect(
      getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
    ).toMatchObject({
      deltaSlotCount: 2,
      processedDeltaCount: 1,
      retainedDeltaRootCount: 1,
    });
    transition.cancel();
    await expect(finished).resolves.toMatchObject({ reason: "cancelled" });
  });

  test("reconciles the latest default and overrides for filtered groups incrementally", async () => {
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: [
        { id: 0, team: "A", score: 0 },
        { id: 1, team: "A", score: 1 },
        { id: 2, team: "B", score: 2 },
        { id: 3, team: "B", score: 3 },
        { id: 4, team: "C", score: 4 },
      ],
      columns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
      initialExpansion: { kind: "collapsed" },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    const groupA = "__group__:team=s:A" as PretableGroupId;
    const groupB = "__group__:team=s:B" as PretableGroupId;
    const groupC = "__group__:team=s:C" as PretableGroupId;
    model.setGroupExpanded(groupA, true);
    model.setGroupExpanded(groupB, true);
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "lt", value: 2 }],
      sort: [],
      rowGroups: [{ columnId: "team" }],
    });

    model.setExpansionDefault(
      { kind: "expanded" },
      { preserveOverrides: true },
    );
    model.setGroupExpanded(groupB, false);
    scheduler.flushAll();
    await transition.finished;

    const snapshot = model.getState().snapshot;
    expect(snapshot.expansion.default).toEqual({ kind: "expanded" });
    expect(snapshot.isGroupExpanded(groupA)).toBe(true);
    expect(snapshot.isGroupExpanded(groupB)).toBe(false);
    expect(snapshot.isGroupExpanded(groupC)).toBe(true);
    expect(snapshot.range(0, 10).map((row) => row.kind)).toEqual([
      "group",
      "data",
      "data",
    ]);
  });

  test("keeps 5k grouped overrides inside the permanent per-slice work cap", async () => {
    interface OverrideRow {
      id: number;
      category: string;
      score: number;
    }
    const overrideHelper = createColumnHelper<OverrideRow>();
    const overrideColumns = [
      overrideHelper.accessor("category", { type: "text" }),
      overrideHelper.accessor("score", { type: "number", aggregate: "sum" }),
    ] as const;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: Array.from({ length: 5_000 }, (_, id) => ({
        id,
        category: `g${id}`,
        score: id,
      })),
      columns: overrideColumns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "category" }],
      },
      initialExpansion: { kind: "collapsed" },
      transitionScheduler: scheduler,
      transitionClock: () => 0,
      transitionBudgetMs: 5,
    });
    for (let id = 0; id < 5_000; id += 1) {
      model.setGroupExpanded(
        `__group__:category=s:g${id}` as PretableGroupId,
        true,
      );
    }
    const transition = model.setDerivations([
      overrideColumns[0],
      { ...overrideColumns[1], aggregate: "avg" as const },
    ]);
    const candidate = getLocalRowModelActiveTransitionCandidateForTesting(
      model,
    ) as { readonly completedRows: number } | undefined;
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    expect(candidate.completedRows).toBe(256);
    scheduler.observeWork(() => candidate.completedRows);

    for (let slice = 0; slice < 19; slice += 1) scheduler.flushOne();
    expect(getLocalRowModelActiveTransitionCandidateForTesting(model)).toBe(
      candidate,
    );
    expect(
      getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
    ).toMatchObject({
      overrideReconciliationRemaining: 4_880,
    });

    scheduler.flushAll();
    await transition.finished;

    expect(scheduler.maxWorkPerTask).toBeLessThanOrEqual(256);
    expect(model.getState().snapshot.range(0, 10_001)).toHaveLength(10_000);
  }, 30_000);

  test("keeps the committed snapshot interactive and reports bounded progress without revisions", async () => {
    const scheduler = new ManualScheduler();
    let evaluations = 0;
    const scored = [
      columns[0],
      {
        ...columns[1],
        accessor: (row: Row) => {
          evaluations += 1;
          return row.score;
        },
        value: (row: Row) => row.score,
      },
    ] as const;
    const model = createLocalRowModel({
      rows: Array.from({ length: 30 }, (_, id) => ({
        id,
        team: id % 2 === 0 ? "A" : "B",
        score: id,
      })),
      columns,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [],
        rowGroups: [],
      },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 4,
    });
    evaluations = 0;
    scheduler.observeWork(() => evaluations);
    const before = model.getState().snapshot;
    const revisions: number[] = [];
    const statuses: string[] = [];
    model.subscribe(() => {
      const state = model.getState();
      revisions.push(state.snapshot.revision);
      statuses.push(state.status.kind);
    });

    const transition = model.setDerivations(scored);

    expect(transition.requestedDerivations).not.toBe(scored);
    expect(Object.isFrozen(transition.requestedDerivations)).toBe(true);
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: {
        kind: "rebuilding",
        transitionId: transition.id,
        completedRows: 4,
        totalRows: 30,
      },
    });
    expect(model.getState().snapshot).toBe(before);
    expect(model.getState().snapshot.rowAt(20)).toMatchObject({ rowId: 20 });

    scheduler.flushOne();
    expect(model.getState().snapshot).toBe(before);
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      completedRows: 8,
      totalRows: 30,
    });
    expect(new Set(revisions)).toEqual(new Set([0]));
    expect(statuses.every((status) => status === "rebuilding")).toBe(true);
    expect(scheduler.maxWorkPerTask).toBeLessThanOrEqual(4);

    scheduler.flushAll();
    await expect(transition.finished).resolves.toBe(1);
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(model.getState().snapshot.revision).toBe(1);
    expect(model.getState().snapshot).not.toBe(before);
  });

  test("returns immutable deep-owned no-op handles and consumes monotonic IDs", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const listener = vi.fn();
    model.subscribe(listener);
    const query = {
      filters: [],
      sort: [],
      rowGroups: [],
    } as const;

    const noop = model.setQuery(query);
    expect(noop.id).toBe(1);
    expect(noop.requestedQuery).not.toBe(query);
    expect(Object.isFrozen(noop.requestedQuery)).toBe(true);
    expect(Object.isFrozen(noop.requestedQuery.filters)).toBe(true);
    await expect(noop.finished).resolves.toBe(0);
    noop.cancel();
    expect(listener).not.toHaveBeenCalled();
    expect(scheduler.entries).toHaveLength(0);

    const changed = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [],
      rowGroups: [],
    });
    expect(changed.id).toBe(2);
    changed.cancel();
    await expect(changed.finished).rejects.toMatchObject({
      transitionId: 2,
      reason: "cancelled",
    });
  });

  test("explicit cancellation releases scheduled work and returns to ready without a revision", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 2,
    });
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 3 }],
      sort: [],
      rowGroups: [],
    });
    const rejection = expect(transition.finished).rejects.toEqual(
      expect.objectContaining({
        name: "PretableTransitionCancelledError",
        transitionId: transition.id,
        reason: "cancelled",
      }),
    );

    transition.cancel();

    await rejection;
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "ready" },
    });
    scheduler.flushAll();
    expect(model.getState().snapshot.revision).toBe(0);
  });

  test("cross-supersession keeps rebuilding under the new ID and stale callbacks are inert", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const observed: unknown[] = [];
    model.subscribe(() => observed.push(model.getState().status));
    const first = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 4 }],
      sort: [],
      rowGroups: [],
    });
    const stale = scheduler.entries[0];
    const firstRejection = expect(first.finished).rejects.toMatchObject({
      transitionId: first.id,
      reason: "superseded",
    });
    const replacement = [
      columns[0],
      { ...columns[1], aggregate: "avg" as const },
    ] as const;

    const second = model.setDerivations(replacement);

    await firstRejection;
    expect(second.id).toBe(first.id + 1);
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      transitionId: second.id,
    });
    expect(
      observed.some(
        (status) =>
          typeof status === "object" &&
          status !== null &&
          "kind" in status &&
          status.kind === "ready",
      ),
    ).toBe(false);
    stale?.task();
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      transitionId: second.id,
    });
    scheduler.flushAll();
    await expect(second.finished).resolves.toBe(1);
    expect(model.getState().snapshot.query).toEqual({
      filters: [],
      sort: [],
      rowGroups: [],
    });
  });

  test("disposal rejects active work, makes queued callbacks inert, and publishes disposed once", async () => {
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const listener = vi.fn();
    model.subscribe(listener);
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 1 }],
      sort: [],
      rowGroups: [],
    });
    const stale = scheduler.entries[0];
    const rejection = expect(transition.finished).rejects.toMatchObject({
      transitionId: transition.id,
      reason: "disposed",
    });
    const beforeDisposeNotifications = listener.mock.calls.length;

    model.dispose();

    await rejection;
    expect(model.getState().status).toEqual({ kind: "disposed" });
    expect(listener).toHaveBeenCalledTimes(beforeDisposeNotifications + 1);
    stale?.task();
    expect(model.getState().status).toEqual({ kind: "disposed" });
    expect(listener).toHaveBeenCalledTimes(beforeDisposeNotifications + 1);
    expect(() => transition.cancel()).toThrowError(PretableDisposedModelError);
    expect(() => transition.cancel()).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "set-query",
      }),
    );
  });

  test("rolls accessor, comparator, and aggregator failures back and later recovers", async () => {
    const failure = new Error("candidate exploded");
    const cases = [
      {
        code: "accessor-failed",
        replacements: [
          columns[0],
          {
            ...columns[1],
            accessor: (row: Row) => {
              if (row.id === 4) throw failure;
              return row.score;
            },
            value: (row: Row) => row.score,
          },
        ] as const,
        query: {
          filters: [{ columnId: "score", operator: "gte", value: 0 }],
          sort: [],
          rowGroups: [],
        } as const,
      },
      {
        code: "comparator-failed",
        replacements: [
          columns[0],
          {
            ...columns[1],
            accessor: (row: Row) => row.score,
            value: (row: Row) => row.score,
            compare: () => {
              throw failure;
            },
          },
        ] as const,
        query: {
          filters: [],
          sort: [{ columnId: "score", direction: "asc" }],
          rowGroups: [],
        } as const,
      },
      {
        code: "aggregator-failed",
        replacements: [
          columns[0],
          {
            ...columns[1],
            aggregate: {
              init: () => 0,
              accumulate: () => {
                throw failure;
              },
              merge: (left: number, right: number) => left + right,
              finalize: (value: number) => value,
            } satisfies PretableAggregator<Row, number, number, number>,
          },
        ] as const,
        query: {
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "team" }],
        } as const,
      },
    ] as const;

    for (const candidate of cases) {
      const scheduler = new ManualScheduler();
      const model = createModel({
        scheduler,
        clock: tickingClock(),
        budgetMs: 2,
      });
      const queryTransition = model.setQuery(candidate.query);
      scheduler.flushAll();
      await queryTransition.finished;
      const before = model.getState().snapshot;
      const transition = model.setDerivations(candidate.replacements);
      const rejection = expect(transition.finished).rejects.toMatchObject({
        code: candidate.code,
        operation: "set-derivations",
        cause: failure,
      });

      scheduler.flushAll();

      await rejection;
      expect(model.getState().snapshot).toBe(before);
      expect(model.getState()).toMatchObject({
        snapshot: { revision: 1 },
        status: {
          kind: "error",
          transitionId: transition.id,
          error: { code: candidate.code, operation: "set-derivations" },
        },
      });

      const recovery = model.setDerivations([
        columns[0],
        { ...columns[1], aggregate: "avg" as const },
      ]);
      scheduler.flushAll();
      await expect(recovery.finished).resolves.toBe(2);
      expect(model.getState().status).toEqual({ kind: "ready" });
    }
  });

  test("replays transactions, replacements, and expansion commits before one atomic swap", async () => {
    const scheduler = new ManualScheduler();
    const groupedColumns = [
      columns[0],
      { ...columns[1], aggregate: "sum" as const },
    ] as const;
    const model = createLocalRowModel({
      rows: Array.from({ length: 8 }, (_, id) => ({
        id,
        team: id < 4 ? "A" : "B",
        score: id,
      })),
      columns: groupedColumns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
      initialExpansion: { kind: "collapsed" },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
    });
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 2 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [{ columnId: "team" }],
    });
    const transitionPromise = transition.finished;

    expect(
      model.applyTransaction({
        update: [{ id: 1, changes: { score: 20 } }],
        add: [{ id: 8, team: "B", score: 80 }],
        remove: [0],
      }),
    ).toMatchObject({ previousRevision: 0, revision: 1 });
    // The collapsed snapshot omits data rows, so use the authoritative source
    // set explicitly while exercising a complete replacement during rebuild.
    expect(
      model.setRows([
        { id: 8, team: "B", score: 80 },
        { id: 7, team: "B", score: 7 },
        { id: 6, team: "B", score: 6 },
        { id: 5, team: "B", score: 5 },
        { id: 4, team: "B", score: 4 },
        { id: 3, team: "A", score: 30 },
        { id: 2, team: "A", score: 2 },
        { id: 1, team: "A", score: 20 },
      ]),
    ).toMatchObject({ previousRevision: 1, revision: 2 });
    const groupA = "__group__:team=s:A" as PretableGroupId;
    expect(model.setGroupExpanded(groupA, true)).toMatchObject({
      previousRevision: 2,
      revision: 3,
    });
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      transitionId: transition.id,
    });

    scheduler.flushAll();
    await expect(transitionPromise).resolves.toBe(4);

    expect(model.getState()).toMatchObject({
      snapshot: {
        revision: 4,
        sourceRowCount: 8,
        query: {
          filters: [{ columnId: "score", operator: "gte", value: 2 }],
          sort: [{ columnId: "score", direction: "desc" }],
          rowGroups: [{ columnId: "team" }],
        },
      },
      status: { kind: "ready" },
    });
    expect(model.getState().snapshot.isGroupExpanded(groupA)).toBe(true);
    expect(rowIds(model)).toEqual([3, 1, 2]);
    expect(
      model
        .getState()
        .snapshot.range(0, 20)
        .filter((row) => row.kind === "group")
        .map((row) => row.childCount),
    ).toEqual([3, 5]);
    expect(model.changesSince(3)).toEqual({
      kind: "reset",
      toRevision: 4,
      reason: "bulk-replace",
    });
  });

  test.each([3, 17, 101, 997])(
    "matches a fresh model after randomized mixed transition catch-up (seed %i)",
    async (seed) => {
      const scheduler = new ManualScheduler();
      let rows = Array.from({ length: 100 }, (_, id) => ({
        id,
        team: ["A", "B", "C", "D"][id % 4]!,
        score: id,
      }));
      let expansion: "expanded" | "collapsed" = "collapsed";
      let randomState = seed;
      const random = () => {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        return randomState;
      };
      const query = {
        filters: [{ columnId: "score", operator: "gte", value: 10 }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team" }],
      } as const;
      const model = createLocalRowModel({
        rows,
        columns,
        initialExpansion: { kind: expansion },
        transitionScheduler: scheduler,
        transitionClock: tickingClock(),
        transitionBudgetMs: 2,
      });
      const transition = model.setQuery(query);

      for (let operation = 0; operation < 40; operation += 1) {
        const choice = random() % 4;
        if (choice < 2) {
          const id = random() % rows.length;
          const score = random() % 200;
          const team = ["A", "B", "C", "D"][random() % 4]!;
          model.applyTransaction({
            update: [{ id, changes: { score, team } }],
          });
          rows = rows.map((row) =>
            row.id === id ? { ...row, score, team } : row,
          );
        } else if (choice === 2) {
          rows = [...rows].reverse();
          model.setRows(rows);
        } else {
          expansion = expansion === "expanded" ? "collapsed" : "expanded";
          if (expansion === "expanded") model.expandAll();
          else model.collapseAll();
        }
      }

      scheduler.flushAll();
      await transition.finished;
      const reference = createLocalRowModel({
        rows,
        columns,
        query,
        initialExpansion: { kind: expansion },
      });
      const summarize = (candidate: typeof model) =>
        candidate
          .getState()
          .snapshot.range(0, Number.MAX_SAFE_INTEGER)
          .map((row) =>
            row.kind === "data"
              ? [row.kind, row.rowId]
              : [
                  row.kind,
                  row.groupId,
                  row.expanded,
                  row.childCount,
                  row.aggregates.score,
                ],
          );

      expect(summarize(model)).toEqual(summarize(reference));
    },
  );

  test("keeps the 100k rebuild sliced and live while a transaction catches up", async () => {
    const scheduler = new ManualScheduler();
    let evaluations = 0;
    const largeColumns = [
      columns[0],
      {
        ...columns[1],
        accessor: (row: Row) => {
          evaluations += 1;
          return row.score;
        },
        value: (row: Row) => row.score,
      },
    ] as const;
    const rows = Array.from({ length: 100_000 }, (_, id) => ({
      id,
      team: id % 10 === 0 ? "A" : "B",
      score: id,
    }));
    const model = createLocalRowModel({
      rows,
      columns: largeColumns,
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 0 }],
        sort: [],
        rowGroups: [],
      },
      initialExpansion: { kind: "expanded" },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 500,
    });
    evaluations = 0;
    scheduler.observeWork(() => evaluations);
    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 100_000 }],
      sort: [],
      rowGroups: [{ columnId: "team" }],
    });
    const finished = transition.finished;

    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      completedRows: 256,
      totalRows: 100_000,
    });
    expect(
      model.applyTransaction({
        update: [{ id: 99_999, changes: { team: "live", score: 100_001 } }],
      }),
    ).toMatchObject({ previousRevision: 0, revision: 1, updated: 1 });
    expect(model.getState().snapshot.rowAt(99_999)).toMatchObject({
      row: { score: 100_001 },
    });

    scheduler.flushAll(1_000);
    await expect(finished).resolves.toBe(2);

    expect(scheduler.maxWorkPerTask).toBeLessThanOrEqual(256);
    expect(
      model.getState().snapshot.indexOf({ kind: "data", rowId: 99_999 }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      model
        .getState()
        .snapshot.range(0, 100_010)
        .some(
          (row) =>
            row.kind === "group" &&
            row.value === "live" &&
            row.aggregates.score === 100_001,
        ),
    ).toBe(true);
    expect(model.getState().status).toEqual({ kind: "ready" });
  }, 30_000);
});
