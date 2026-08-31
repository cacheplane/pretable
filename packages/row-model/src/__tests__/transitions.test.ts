import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  PretableDisposedModelError,
  type PretableAggregator,
  type PretableGroupId,
} from "../index";
import {
  createCooperativeTransitionRuntime,
  getCooperativeTransitionCandidateDiagnosticsForTesting,
  runCooperativeTransitionSlice,
  TRANSITION_CLOCK_CHECK_STRIDE,
  type CooperativeTransitionScheduler,
} from "../cooperative-transition";
import {
  getLocalRowModelActiveTransitionCandidateForTesting,
  getLocalRowModelRevisionCauseForTesting,
} from "../create-local-row-model";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import { getDistinctValueDiagnosticsForTesting } from "../distinct-values";

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

interface TransitionProgress {
  readonly completedRows: number;
  readonly totalRows: number;
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

class ThrowingCancelScheduler extends ManualScheduler {
  readonly cancellationFailure = new Error("scheduler cancellation exploded");

  override schedule(task: () => void): () => void {
    const cancel = super.schedule(task);
    return () => {
      cancel();
      throw this.cancellationFailure;
    };
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
  readonly scheduler?: CooperativeTransitionScheduler;
  readonly budgetMs?: number;
  readonly clock?: () => number;
  readonly maxUnitsPerSlice?: number;
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
    transitionMaxUnitsPerSlice: options.maxUnitsPerSlice,
  });
}

describe("cooperative query and derivation transitions", () => {
  test("switches min/max lowering when column semantics transition to and from date", async () => {
    interface DatedRow {
      readonly id: number;
      readonly team: string;
      readonly asOf: string | null;
    }
    const dated = createColumnHelper<DatedRow>();
    const datedColumns = [
      dated.accessor("team", { type: "text" }),
      dated.accessor("asOf", { type: "date", aggregate: "min" }),
    ] as const;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: [
        { id: 1, team: "A", asOf: "2026-08-18" },
        { id: 2, team: "A", asOf: "2025-01-01" },
      ],
      columns: datedColumns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
      transitionScheduler: scheduler,
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
      transitionMaxUnitsPerSlice: 1,
    });
    const aggregate = () => {
      const group = model.getState().snapshot.rowAt(0);
      if (group?.kind !== "group") throw new Error("missing team group");
      return group.aggregates.asOf;
    };

    expect(aggregate()).toBe("2025-01-01");
    const numeric = model.setDerivations([
      datedColumns[0],
      { ...datedColumns[1], type: "number" },
    ] as never);
    scheduler.flushAll();
    await expect(numeric.finished).resolves.toBe(1);
    expect(aggregate()).toBeNull();

    const calendarDate = model.setDerivations(datedColumns);
    scheduler.flushAll();
    await expect(calendarDate.finished).resolves.toBe(2);
    expect(aggregate()).toBe("2025-01-01");
    expect(calendarDate.requestedDerivations[1]?.aggregate).toBe("min");
  });

  test.each([
    ["text", "date"],
    ["date", "text"],
  ] as const)(
    "invalidates %s -> %s semantics once without discarding an unrelated distinct index",
    async (initialType, nextType) => {
      interface DatedRow {
        id: number;
        asOf: string | null;
        label: string;
      }
      const dated = createColumnHelper<DatedRow>();
      const datedColumns = [
        dated.accessor("asOf", { type: initialType }),
        dated.accessor("label", { type: "text" }),
      ] as const;
      const scheduler = new ManualScheduler();
      const instrumented = createInstrumentedLocalRowModel({
        rows: [
          { id: 1, asOf: "2026-08-06", label: "one" },
          { id: 2, asOf: "2025-12-31", label: "two" },
          { id: 3, asOf: null, label: "three" },
        ],
        columns: datedColumns,
        query: {
          filters: [{ columnId: "asOf", operator: "isNotEmpty" }],
          sort: [{ columnId: "asOf", direction: "desc" }],
          rowGroups: [{ columnId: "asOf", direction: "asc" }],
        },
        initialExpansion: { kind: "expanded" },
        transitionScheduler: scheduler,
        transitionClock: tickingClock(),
        transitionBudgetMs: 1,
        transitionMaxUnitsPerSlice: 1,
      });
      const { model, diagnostics } = instrumented;
      const dateDistinct = model.distinctValues("asOf", {
        includeBlanks: true,
        limit: 10,
      });
      const labelDistinct = model.distinctValues("label", { limit: 10 });
      scheduler.flushAll();
      await Promise.all([dateDistinct.finished, labelDistinct.finished]);
      expect(
        getDistinctValueDiagnosticsForTesting(model).retainedDictionaryCount,
      ).toBe(2);
      diagnostics.resetWork();

      const transition = model.setDerivations([
        { ...datedColumns[0], type: nextType },
        datedColumns[1],
      ] as never);
      scheduler.flushAll();
      await expect(transition.finished).resolves.toBe(1);

      expect(model.getState()).toMatchObject({
        snapshot: { revision: 1 },
        status: { kind: "ready" },
      });
      expect(diagnostics.read().work).toMatchObject({
        rowsEvaluated: 3,
        transitionRows: 3,
      });
      expect(
        getDistinctValueDiagnosticsForTesting(model).retainedDictionaryCount,
      ).toBe(1);
      const beforeUnrelatedRead = diagnostics.read().work.rowsEvaluated;
      const retainedLabel = model.distinctValues("label", { limit: 10 });
      expect(retainedLabel.status).toBe("ready");
      await expect(retainedLabel.finished).resolves.toMatchObject({
        values: [
          { value: "one", count: 1 },
          { value: "three", count: 1 },
          { value: "two", count: 1 },
        ],
      });
      expect(diagnostics.read().work.rowsEvaluated).toBe(beforeUnrelatedRead);
    },
  );

  test("treats dateFormat as presentation-only with zero derivation work", async () => {
    interface DatedRow {
      readonly id: number;
      readonly asOf: string | null;
    }
    const dated = createColumnHelper<DatedRow>();
    const initialColumn = dated.accessor("asOf", {
      type: "date",
      dateFormat: { dateStyle: "medium" },
    });
    const initialColumns = [initialColumn] as const;
    const { model, diagnostics } = createInstrumentedLocalRowModel({
      rows: [
        { id: 1, asOf: "2026-08-18" },
        { id: 2, asOf: "2025-01-01" },
      ],
      columns: initialColumns,
      query: {
        filters: [],
        sort: [{ columnId: "asOf", direction: "asc" }],
        rowGroups: [],
      },
    });
    const beforeSnapshot = model.getState().snapshot;
    const beforeFirstRow = beforeSnapshot.rowAt(0);
    diagnostics.resetWork();
    const beforeWork = diagnostics.read().work;

    const transition = model.setDerivations([
      { ...initialColumn, dateFormat: { dateStyle: "long" } },
    ] as never);
    await expect(transition.finished).resolves.toBe(0);

    const afterSnapshot = model.getState().snapshot;
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(diagnostics.read().work).toEqual(beforeWork);
    expect(afterSnapshot.rowAt(0)).toBe(beforeFirstRow);
  });

  test("keeps the default cooperative work budget below the browser gate margin", () => {
    let tick = 0;
    let steps = 0;
    const runtime = createCooperativeTransitionRuntime({
      scheduler: new ManualScheduler(),
      now: () => {
        const current = tick;
        tick += 0.125;
        return current;
      },
    });

    expect(
      runCooperativeTransitionSlice(runtime, () => {
        steps += 1;
        return false;
      }),
    ).toBe(false);
    // The clock is consulted after the first unit and then once per stride
    // (#500). It advances 0.125 per reading, so the first-unit check sees
    // 0.125 < 0.25 and the first stride boundary sees 0.25 >= 0.25: exactly
    // one stride runs.
    expect(steps).toBe(TRANSITION_CLOCK_CHECK_STRIDE);
  });

  test("dispatches flat and grouped transitions to their candidate modules", async () => {
    // The flat lane lives in flat-cooperative-candidate.ts and the grouped
    // lanes in cooperative-transition.ts. The diagnostics shape carries no
    // module marker beyond the grouped-only fields, so this pins the dispatch
    // seam from both sides; the extraction's real oracle is the whole suite.
    const scheduler = new ManualScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });

    const flat = model.setQuery({
      // Filter AND sort change together so the transition cannot take a
      // synchronous fast path and the cooperative candidate is observable.
      filters: [{ columnId: "score", operator: "gte", value: 2 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    const flatCandidate =
      getLocalRowModelActiveTransitionCandidateForTesting(model);
    expect(flatCandidate).toBeDefined();
    if (flatCandidate === undefined) return;
    expect(
      getCooperativeTransitionCandidateDiagnosticsForTesting(flatCandidate),
    ).toMatchObject({
      released: false,
      hasGroups: false,
      overrideReconciliationRemaining: 0,
    });
    scheduler.flushAll();
    await flat.finished;
    expect(rowIds(model)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

    const grouped = model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team" }],
    });
    const groupedCandidate =
      getLocalRowModelActiveTransitionCandidateForTesting(model);
    expect(groupedCandidate).toBeDefined();
    if (groupedCandidate === undefined) return;
    expect(groupedCandidate).not.toBe(flatCandidate);
    expect(
      getCooperativeTransitionCandidateDiagnosticsForTesting(groupedCandidate),
    ).toMatchObject({ released: false, hasGroups: true });
    scheduler.flushAll();
    await grouped.finished;
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(rowIds(model)).toHaveLength(12);
  });

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
        // Filter AND sort change together: either alone would commit
        // synchronously (the #457 sort and filter fast paths) and postTask
        // would never be consulted; the subject is the scheduler fallback.
        filters: [{ columnId: "score", operator: "gte", value: 2 }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [],
      });
      const outcome = await Promise.race([
        transition.finished,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 1_000),
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
          setTimeout(() => resolve("timeout"), 1_000),
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
    // Re-pinned for the M2 amendment (#490): a flat set-query's build unit is
    // now ONE slot-vector chunk (1_024 rows), so the default 256-unit cap can
    // no longer bind on a small flat fixture — the fixture spans three chunks
    // and caps the slice at two units, and the bounded first slice completes
    // exactly two chunks' worth of rows (impossible under one-row units).
    const model = createModel({
      rows: Array.from({ length: 3_000 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      scheduler,
      clock: () => 0,
      budgetMs: 5,
      maxUnitsPerSlice: 2,
    });

    const transition = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 0 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });

    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      completedRows: 2_048,
      totalRows: 3_000,
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
      // The filter change keeps this off the #457 sort-only fast path; the
      // subject is cooperative delta-journal accounting.
      filters: [{ columnId: "score", operator: "gte", value: 0 }],
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

    for (let index = 0; index < 20; index += 1) {
      scheduler.flushOne();
      if (
        getCooperativeTransitionCandidateDiagnosticsForTesting(candidate)
          .processedDeltaCount === 1
      ) {
        break;
      }
    }

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

  test("removes a captured group override changed while the grouped build seals", async () => {
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: Array.from({ length: 1_000 }, (_, id) => ({
        id,
        team: id % 2 === 0 ? "A" : "B",
        score: id,
      })),
      columns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
      initialExpansion: { kind: "collapsed" },
      transitionScheduler: scheduler,
      transitionClock: () => 0,
    });
    const groupA = "__group__:team=s:A" as PretableGroupId;
    model.setGroupExpanded(groupA, true);

    const transition = model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [{ columnId: "team" }],
    });
    model.setGroupExpanded(groupA, false);

    scheduler.flushAll();
    await transition.finished;

    const snapshot = model.getState().snapshot;
    expect(snapshot.expansion.overrideCount).toBe(0);
    expect(snapshot.isGroupExpanded(groupA)).toBe(false);
    expect(snapshot.range(0, 10).map((row) => row.kind)).toEqual([
      "group",
      "group",
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
    expect(candidate.completedRows).toBe(5_120);
    expect(
      getCooperativeTransitionCandidateDiagnosticsForTesting(candidate),
    ).toMatchObject({
      released: false,
      hasGroups: true,
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
      // A whole-tick clock exceeds any sub-tick budget at the FIRST-unit
      // clock check (#500), so every slice runs exactly one unit and the
      // partial states below stay observable.
      transitionClock: tickingClock(),
      transitionBudgetMs: 1,
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
        completedRows: 1,
        totalRows: 30,
      },
    });
    expect(model.getState().snapshot).toBe(before);
    expect(model.getState().snapshot.rowAt(20)).toMatchObject({ rowId: 20 });

    scheduler.flushOne();
    expect(model.getState().snapshot).toBe(before);
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      completedRows: 2,
      totalRows: 30,
    });
    expect(new Set(revisions)).toEqual(new Set([0]));
    expect(statuses.every((status) => status === "rebuilding")).toBe(true);
    expect(scheduler.maxWorkPerTask).toBeLessThanOrEqual(1);

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
      // Filter AND sort change: either alone commits synchronously (#457
      // fast paths); this handle must stay pending to be cancellable.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
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
      // Budget 1 + whole-tick clock: the first-unit check ends every slice
      // after one unit (#500), keeping cooperative work pending to cancel.
      clock: tickingClock(),
      budgetMs: 1,
    });
    const transition = model.setQuery({
      // Filter AND sort change: either alone commits synchronously (#457
      // fast paths); cancellation needs scheduled cooperative work to
      // release.
      filters: [{ columnId: "score", operator: "gte", value: 3 }],
      sort: [{ columnId: "score", direction: "desc" }],
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

  test("hostile cancellation hooks cannot interrupt cancellation, supersession, or disposal", async () => {
    const scheduler = new ThrowingCancelScheduler();
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const listener = vi.fn();
    model.subscribe(listener);

    const first = model.setQuery({
      // Every transition in this test pairs the filter change with a sort
      // change: either facet alone commits synchronously (#457 fast paths)
      // and the hostile hooks need PENDING cooperative work to attack.
      filters: [{ columnId: "score", operator: "gte", value: 3 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    const firstStaleTask = scheduler.entries[0]?.task;
    expect(listener).toHaveBeenCalledTimes(1);

    expect(() => first.cancel()).not.toThrow();
    await expect(first.finished).rejects.toMatchObject({
      transitionId: first.id,
      reason: "cancelled",
    });
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "ready" },
    });
    expect(listener).toHaveBeenCalledTimes(2);
    firstStaleTask?.();
    expect(listener).toHaveBeenCalledTimes(2);

    const superseded = model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 4 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    const supersededStaleTask = scheduler.entries.at(-1)?.task;
    const replacement = model.setQuery({
      // Filter AND sort change against the committed plan: a sort-only or
      // filter-only replacement would commit synchronously (#457 fast
      // paths) and this test needs a pending transition to dispose.
      filters: [{ columnId: "score", operator: "gte", value: 5 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    await expect(superseded.finished).rejects.toMatchObject({
      transitionId: superseded.id,
      reason: "superseded",
    });
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      transitionId: replacement.id,
    });
    supersededStaleTask?.();
    expect(model.getState().status).toMatchObject({
      kind: "rebuilding",
      transitionId: replacement.id,
    });

    const notificationsBeforeDispose = listener.mock.calls.length;
    const replacementStaleTask = scheduler.entries.at(-1)?.task;
    expect(() => model.dispose()).not.toThrow();
    await expect(replacement.finished).rejects.toMatchObject({
      transitionId: replacement.id,
      reason: "disposed",
    });
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 0 },
      status: { kind: "disposed" },
    });
    expect(listener).toHaveBeenCalledTimes(notificationsBeforeDispose + 1);
    replacementStaleTask?.();
    expect(listener).toHaveBeenCalledTimes(notificationsBeforeDispose + 1);
  });

  test("transition failures preserve their typed error with a hostile cancellation hook", async () => {
    const scheduler = new ThrowingCancelScheduler();
    const failure = new Error("accessor exploded");
    const model = createModel({
      scheduler,
      clock: tickingClock(),
      budgetMs: 1,
    });
    const before = model.getState().snapshot;
    const transition = model.setDerivations([
      columns[0],
      {
        ...columns[1],
        accessor: (row: Row) => {
          if (row.id === 2) throw failure;
          return row.score;
        },
        value: (row: Row) => row.score,
      },
    ]);

    scheduler.flushAll();

    await expect(transition.finished).rejects.toMatchObject({
      code: "accessor-failed",
      operation: "set-derivations",
      cause: failure,
    });
    expect(model.getState().snapshot).toBe(before);
    expect(model.getState().status).toMatchObject({
      kind: "error",
      transitionId: transition.id,
      error: { code: "accessor-failed", cause: failure },
    });
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
      // Filter AND sort change: either alone commits synchronously (#457
      // fast paths); cross-supersession needs `first` still rebuilding.
      filters: [{ columnId: "score", operator: "gte", value: 4 }],
      sort: [{ columnId: "score", direction: "desc" }],
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
      // Filter AND sort change: either alone commits synchronously (#457
      // fast paths); disposal needs an ACTIVE transition to reject.
      filters: [{ columnId: "score", operator: "gte", value: 1 }],
      sort: [{ columnId: "score", direction: "desc" }],
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

  test("accounts catch-up removal and insertion as separate cooperative units", async () => {
    const scheduler = new ManualScheduler();
    let evaluations = 0;
    const replayColumns = [
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
      rows: Array.from({ length: 4 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      columns: replayColumns,
      transitionScheduler: scheduler,
      transitionClock: () => 0,
      transitionMaxUnitsPerSlice: 1,
    });
    evaluations = 0;
    const transition = model.setQuery({
      // Every row is team "A", so this filter changes no verdict but keeps
      // the query off the #457 sort-only fast path; the subject is the
      // cooperative catch-up machinery.
      filters: [{ columnId: "team", operator: "equals", value: "A" }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    model.applyTransaction({
      update: [{ id: 0, changes: { score: 10 } }],
    });
    const candidate = getLocalRowModelActiveTransitionCandidateForTesting(
      model,
    ) as TransitionProgress | undefined;
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    expect(candidate.totalRows).toBe(7);
    while (candidate.completedRows < 4) scheduler.flushOne();

    evaluations = 0;
    scheduler.flushOne();
    expect(candidate.completedRows).toBe(5);
    expect(evaluations).toBe(0);
    scheduler.flushOne();
    expect(candidate.completedRows).toBe(6);
    expect(evaluations).toBe(1);

    scheduler.flushAll();
    await transition.finished;
    expect(rowIds(model)).toEqual([0, 3, 2, 1]);
  });

  test("cancels safely between catch-up removal and insertion", async () => {
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: Array.from({ length: 4 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      columns,
      transitionScheduler: scheduler,
      transitionClock: () => 0,
      transitionMaxUnitsPerSlice: 1,
    });
    const transition = model.setQuery({
      // Every row is team "A", so this filter changes no verdict but keeps
      // the query off the #457 sort-only fast path; the subject is the
      // cooperative catch-up machinery.
      filters: [{ columnId: "team", operator: "equals", value: "A" }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    model.applyTransaction({
      update: [{ id: 0, changes: { score: 10 } }],
    });
    const candidate = getLocalRowModelActiveTransitionCandidateForTesting(
      model,
    ) as TransitionProgress | undefined;
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    while (candidate.completedRows < 4) scheduler.flushOne();
    scheduler.flushOne();
    expect(candidate.completedRows).toBe(5);
    const committed = model.getState().snapshot;

    transition.cancel();
    await expect(transition.finished).rejects.toMatchObject({
      transitionId: transition.id,
      reason: "cancelled",
    });
    scheduler.flushAll();

    expect(model.getState()).toEqual({
      snapshot: committed,
      status: { kind: "ready" },
    });
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      rowId: 0,
      row: { score: 10 },
    });
  });

  test("supersedes safely between catch-up removal and insertion", async () => {
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: Array.from({ length: 4 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      columns,
      transitionScheduler: scheduler,
      transitionClock: () => 0,
      transitionMaxUnitsPerSlice: 1,
    });
    const transition = model.setQuery({
      // Every row is team "A", so this filter changes no verdict but keeps
      // the query off the #457 sort-only fast path; the subject is the
      // cooperative catch-up machinery.
      filters: [{ columnId: "team", operator: "equals", value: "A" }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [],
    });
    model.applyTransaction({
      update: [{ id: 0, changes: { score: 10 } }],
    });
    const candidate = getLocalRowModelActiveTransitionCandidateForTesting(
      model,
    ) as TransitionProgress | undefined;
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    while (candidate.completedRows < 4) scheduler.flushOne();
    scheduler.flushOne();
    const staleInsertion = scheduler.entries[0]?.task;

    const replacement = model.setQuery({
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    await expect(transition.finished).rejects.toMatchObject({
      transitionId: transition.id,
      reason: "superseded",
    });
    staleInsertion?.();
    scheduler.flushAll();
    await replacement.finished;

    expect(model.getState()).toMatchObject({
      snapshot: { revision: 2 },
      status: { kind: "ready" },
    });
    expect(rowIds(model)).toEqual([1, 2, 3, 0]);
  });

  test("preserves a typed catch-up insertion error and the live revision", async () => {
    const scheduler = new ManualScheduler();
    const failure = new Error("catch-up accessor exploded");
    const model = createLocalRowModel({
      rows: Array.from({ length: 4 }, (_, id) => ({
        id,
        team: "A",
        score: id,
      })),
      columns,
      transitionScheduler: scheduler,
      transitionClock: () => 0,
      transitionMaxUnitsPerSlice: 1,
    });
    const transition = model.setDerivations([
      columns[0],
      {
        ...columns[1],
        accessor: (row: Row) => {
          if (row.score === 10) throw failure;
          return row.score;
        },
        value: (row: Row) => row.score,
      },
    ]);
    model.applyTransaction({
      update: [{ id: 0, changes: { score: 10 } }],
    });
    const candidate = getLocalRowModelActiveTransitionCandidateForTesting(
      model,
    ) as TransitionProgress | undefined;
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    while (candidate.completedRows < 4) scheduler.flushOne();
    scheduler.flushOne();
    expect(model.getState().status).toMatchObject({ kind: "rebuilding" });

    scheduler.flushOne();
    await expect(transition.finished).rejects.toMatchObject({
      code: "accessor-failed",
      operation: "set-derivations",
      cause: failure,
    });
    expect(model.getState()).toMatchObject({
      snapshot: { revision: 1 },
      status: {
        kind: "error",
        transitionId: transition.id,
        error: { code: "accessor-failed", cause: failure },
      },
    });
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      rowId: 0,
      row: { score: 10 },
    });
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
