import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  PretableReentrantMutationError,
  PretableRowModelError,
  PretableTransitionCancelledError,
  type PretableQueryFor,
} from "../index";
import {
  compareRecordRows,
  filterVerdict,
  sortKeysOf,
  type CompiledQuery,
} from "../compiled-query";
import { rowPassesFilter } from "../filter-membership";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import type { RevisionRoot } from "../internal-types";
import { compareOrderStatisticTreeIds } from "../persistent/order-statistic-tree";
import { createPersistentMap } from "../persistent/persistent-map";
import { buildRowStore } from "../row-store";
import { createSlotAllocator } from "../slot-allocator";
import { rebuildRootForSortOnlyChange } from "../sort-rebuild";
import type { PretableGroupId } from "../types";
import { createVisibleIndex } from "../visible-index";

interface Holding {
  id: string;
  team: string;
  score: number;
  note: string;
  label: string;
}

const helper = createColumnHelper<Holding>();

/**
 * Checks a query literal against a column tuple, exactly as
 * `query-delta.test.ts` does.
 */
function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

/**
 * Builds the shared fixture: spied accessors on every column so tests can
 * assert exactly which accessors a carryover rebuild runs. `label` is inactive
 * in BOTH plans (never sorted, filtered, grouped, or aggregated), so its spy
 * count must be 0 throughout — including the setup `evaluate`.
 */
function createFixture() {
  const teamAccessor = vi.fn((row: Holding) => row.team);
  const scoreAccessor = vi.fn((row: Holding) => row.score);
  const noteAccessor = vi.fn((row: Holding) => row.note);
  const labelAccessor = vi.fn((row: Holding) => row.label);
  const columns = [
    helper.accessor("team", teamAccessor, { type: "text" }),
    helper.accessor("score", scoreAccessor, {
      type: "number",
      aggregate: "sum",
    }),
    helper.accessor("note", noteAccessor, { type: "text" }),
    helper.accessor("label", labelAccessor, { type: "text" }),
  ] as const;
  return { columns, teamAccessor, scoreAccessor, noteAccessor, labelAccessor };
}

type FixtureColumns = ReturnType<typeof createFixture>["columns"];

const SCORE_DESC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "score", direction: "desc" }],
  rowGroups: [],
});

const SCORE_ASC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "score", direction: "asc" }],
  rowGroups: [],
});

const NOTE_ASC_TEAM_FILTER = queryFor<FixtureColumns>({
  filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
  sort: [{ columnId: "note", direction: "asc" }],
  rowGroups: [],
});

/**
 * Seven rows chosen so the three orders that matter are pairwise-distinct
 * permutations (asserted below): source order, score-desc order, note-asc
 * order. `h3` fails the team filter; `h4`/`h5` tie on `note`, and `h5`
 * appears BEFORE `h4` in source order while its id sorts AFTER — so the
 * engine's real tie resolution (compareRecordRows falls through to sourceOrder)
 * and an id-based one produce OPPOSITE orders for the tied pair, and the
 * expectations below can disprove either mistake.
 */
const ROOT_ROWS: readonly Holding[] = Object.freeze([
  { id: "h1", team: "Alpha", score: 50, note: "delta", label: "u" },
  { id: "h2", team: "Alpha", score: 10, note: "alpha", label: "u" },
  { id: "h3", team: "Beta", score: 99, note: "aaaa", label: "u" },
  { id: "h5", team: "Alpha", score: 70, note: "bravo", label: "u" },
  { id: "h4", team: "Alpha", score: 30, note: "bravo", label: "u" },
  { id: "h6", team: "Alpha", score: 20, note: "echo", label: "u" },
  { id: "h7", team: "Alpha", score: 60, note: "charlie", label: "u" },
]);

const SOURCE_VISIBLE_ORDER = ["h1", "h2", "h5", "h4", "h6", "h7"] as const;
const OLD_VISIBLE_ORDER = ["h5", "h7", "h1", "h4", "h6", "h2"] as const;
const NEW_VISIBLE_ORDER = ["h2", "h5", "h4", "h7", "h1", "h6"] as const;

function createRoot<TColumns>(
  queryPlan: CompiledQuery<TColumns>,
  rows: readonly Holding[],
): RevisionRoot<Holding, string, TColumns> {
  const store = buildRowStore<Holding, string, TColumns>({
    rows,
    getRowId: (row) => row.id,
    queryPlan,
    slots: createSlotAllocator(),
  });
  const defaultPolicy = Object.freeze({ kind: "expanded" as const });
  const expansion = Object.freeze({
    default: defaultPolicy,
    overrides: createPersistentMap<PretableGroupId, boolean>(),
    state: Object.freeze({ default: defaultPolicy, overrideCount: 0 }),
  });
  return Object.freeze({
    revision: 0,
    parentRevision: null,
    rows: store.rows,
    sourceOrder: store.sourceOrder,
    visible: createVisibleIndex(
      store.records,
      queryPlan,
      false,
      expansion.overrides,
    ),
    queryPlan,
    expansion,
    cause: Object.freeze({ kind: "initial" as const }),
  });
}

function rankedIds(
  visible: RevisionRoot<Holding, string, unknown>["visible"],
): readonly string[] {
  const ids: string[] = [];
  for (let index = 0; index < visible.rows.size; index += 1) {
    ids.push(visible.rows.entryAt(index)!.record.rowId);
  }
  return ids;
}

function testInstrumentation(): LocalRowModelInstrumentation {
  return {
    work: {
      rowsEvaluated: 0,
      hamtNodesCopied: 0,
      orderNodesCopied: 0,
      groupNodesCopied: 0,
      aggregateMerges: 0,
      transitionRows: 0,
      snapshotOutputRowsRead: 0,
      synchronousRebuilds: 0,
      synchronousRebuildMs: 0,
      filterRebuilds: 0,
      filterRowsFlipped: 0,
      filterMergeSortedInsertions: 0,
      filterRebuildMs: 0,
      bulkByIdDerived: 0,
      bulkOrderVerificationsSkipped: 0,
      evaluationCacheAdoptions: 0,
      sortKeyCarries: 0,
      sortKeyEvaluations: 0,
      schedulerSliceDurations: [],
    },
    snapshotRoots: new WeakMap(),
    retainedSnapshots: new Map(),
    scheduledCallbacks: new Set(),
    currentRevisionRoot: undefined,
    model: undefined,
  };
}

describe("rebuildRootForSortOnlyChange", () => {
  function createRebuildFixture() {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    // Fixture controls: the three orders must be pairwise-distinct
    // permutations, or a rebuild that ignores the sort could still pass.
    expect(rankedIds(captured.visible)).toEqual(OLD_VISIBLE_ORDER);
    expect(OLD_VISIBLE_ORDER).not.toEqual(NEW_VISIBLE_ORDER);
    expect(OLD_VISIBLE_ORDER).not.toEqual(SOURCE_VISIBLE_ORDER);
    expect(NEW_VISIBLE_ORDER).not.toEqual(SOURCE_VISIBLE_ORDER);
    expect([...OLD_VISIBLE_ORDER].sort()).toEqual(
      [...NEW_VISIBLE_ORDER].sort(),
    );
    // Tiebreak control: the note-tied pair's source order OPPOSES its id
    // order, so ties resolved by rowId instead of the engine's sourceOrder
    // fallthrough (compareRecordRows' final clause) cannot pass by luck — and the
    // NEW_VISIBLE_ORDER expectation pins the sourceOrder resolution (h5
    // before h4).
    expect(SOURCE_VISIBLE_ORDER.indexOf("h5")).toBeLessThan(
      SOURCE_VISIBLE_ORDER.indexOf("h4"),
    );
    expect(compareOrderStatisticTreeIds("h4", "h5")).toBeLessThan(0);
    return { fixture, previousPlan, nextPlan, captured };
  }

  test("the rebuilt root's visible order equals a cold build under nextPlan", () => {
    const { fixture, nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // Oracle: an identical plan compiled WITHOUT `previous` chaining (cold
    // cache), evaluated from scratch, sorted with the same composite order
    // the visible tree maintains.
    const twinPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    expect(twinPlan).not.toBe(nextPlan);
    const expected = ROOT_ROWS.map((row, sourceOrder) => ({
      rowId: row.id,
      input: { rowId: row.id, row, sourceOrder },
      metadata: twinPlan.evaluate({ rowId: row.id, row, sourceOrder }),
    }))
      .filter((entry) => filterVerdict(twinPlan, entry.input))
      .sort(
        (left, right) =>
          compareRecordRows(twinPlan, left.input, right.input) ||
          compareOrderStatisticTreeIds(left.rowId, right.rowId),
      )
      .map((entry) => entry.rowId);
    expect(expected).toEqual([...NEW_VISIBLE_ORDER]);
    expect(rankedIds(rebuilt.visible)).toEqual(expected);
  });

  test("filtered-out rows stay out of visible but keep updated records in rows", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    expect(rebuilt.visible.rows.rankOf("h3")).toBeUndefined();
    const record = rebuilt.rows.get("h3");
    expect(record).toBeDefined();
    // The rebuilt root's own membership is the verdict, and it says "out".
    expect(rowPassesFilter(rebuilt, "h3")).toBe(false);
    // The NEW plan's store was filled for the filtered-out row too: sort keys
    // resolve under nextPlan as note, not score.
    expect(sortKeysOf(nextPlan, record!)).toEqual([
      { columnId: "note", value: "aaaa" },
    ]);
    expect(rebuilt.rows.size).toBe(ROOT_ROWS.length);
    expect(rebuilt.visible.rows.size).toBe(NEW_VISIBLE_ORDER.length);
  });

  test("revision, parentRevision, queryPlan, and cause are the requested values", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 5,
      now: () => 0,
    });

    expect(rebuilt.revision).toBe(5);
    expect(rebuilt.parentRevision).toBe(4);
    expect(rebuilt.queryPlan).toBe(nextPlan);
    expect(rebuilt.cause).toEqual({ kind: "set-query" });
  });

  test("sourceOrder and expansion are carried by reference from the captured root", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    expect(rebuilt.sourceOrder).toBe(captured.sourceOrder);
    expect(rebuilt.expansion).toBe(captured.expansion);
  });

  test("the rows map and every record carry by IDENTITY", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // The entire point of sort-rebuild v2: no record rebuild, no rows
    // transient — the committed root's rows map IS the captured one.
    expect(rebuilt.rows).toBe(captured.rows);
    for (const row of ROOT_ROWS) {
      const before = captured.rows.get(row.id)!;
      const after = rebuilt.rows.get(row.id)!;
      expect(after).toBe(before);
      expect(after.publicRow).toBe(before.publicRow);
      expect(after.integrity).toBe(before.integrity);
      expect(after.row).toBe(before.row);
      expect(after.sourceOrder).toBe(before.sourceOrder);
    }
    // Identity carried, order still changed — the positive twin.
    expect(rankedIds(rebuilt.visible)).toEqual([...NEW_VISIBLE_ORDER]);
  });

  test("aggregate-leaf dependencies carry by identity and values stay correct", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // Record identity implies leaf and dependency identity; asserted on a
    // concrete leaf anyway so a future record rebuild cannot silently start
    // dirtying aggregate leaves on sort-only changes.
    for (const row of ROOT_ROWS) {
      const before = captured.rows.get(row.id)!.metadata.aggregateLeaves[0];
      const after = rebuilt.rows.get(row.id)!.metadata.aggregateLeaves[0];
      expect(after).toBe(before);
      expect(after.allLeaf.dependency).toBe(before.allLeaf.dependency);
      // Positive twin: the carried leaf still holds the row's real value.
      expect(after.allLeaf.value).toBe(row.score);
    }
  });

  test("instrumentation counts one rebuild and the measured duration", () => {
    const { nextPlan, captured } = createRebuildFixture();
    const instrumentation = testInstrumentation();
    const ticks = [0, 7];
    let call = 0;

    rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => ticks[call++] ?? 7,
      instrumentation,
    });

    expect(instrumentation.work.synchronousRebuilds).toBe(1);
    expect(instrumentation.work.synchronousRebuildMs).toBe(7);
  });

  test("the sort commit claims the order proof and NOT the derived byId", () => {
    const { nextPlan, captured } = createRebuildFixture();
    const instrumentation = testInstrumentation();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
      instrumentation,
    });

    expect(instrumentation.work.bulkOrderVerificationsSkipped).toBe(1);
    // Deliberate abstention, not an oversight. A sort-only change keeps the
    // entry SET but re-decorates every entry with the next plan's keys, so
    // every "survivor" is a NEW object; a map derived from the captured
    // tree would keep returning the previous plan's entries. The assertion
    // below is the reason, measured: not one visible entry survives by
    // identity, so there is nothing for a derivation to carry.
    expect(instrumentation.work.bulkByIdDerived).toBe(0);
    let reused = 0;
    for (const entry of rebuilt.visible.rows.entries()) {
      const id = entry.record.rowId;
      expect(rebuilt.visible.rows.get(id)).toBe(entry);
      if (captured.visible.rows.get(id) === entry) reused += 1;
    }
    expect(rebuilt.visible.rows.size).toBeGreaterThan(0);
    expect(reused).toBe(0);
  });

  test("throws TypeError when the plans are not a sort-only change", () => {
    const { fixture, captured } = createRebuildFixture();
    const filterChangedPlan = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      }),
    });

    expect(() =>
      rebuildRootForSortOnlyChange({
        captured,
        nextPlan: filterChangedPlan,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError("Synchronous rebuild requires a sort-only plan change."),
    );
  });

  test("throws TypeError for a grouped next plan", () => {
    const fixture = createFixture();
    const groupedPrevious = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      }),
    });
    const groupedNext = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "team", operator: "equals", value: "Alpha" }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      }),
    });
    const captured = createRoot(groupedPrevious, ROOT_ROWS);

    expect(() =>
      rebuildRootForSortOnlyChange({
        captured,
        nextPlan: groupedNext,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError("Synchronous rebuild requires an ungrouped query."),
    );
  });
});

/**
 * Minimal deterministic scheduler, duplicated from `transitions.test.ts`
 * (which exports nothing; test files here do not import from each other).
 */
class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: { readonly task: () => void; cancelled: boolean }[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushAll(limit = 1_000_000): void {
    let count = 0;
    for (;;) {
      const entry = this.entries.shift();
      if (entry === undefined) return;
      if (!entry.cancelled) entry.task();
      count += 1;
      if (count > limit) throw new Error("Manual scheduler did not settle.");
    }
  }
}

/**
 * `h8` extends the shared seven-row fixture to eight rows; it sorts last
 * under source order, score-desc, and note-asc alike, so the pairwise
 * distinctness of the three orders (and the h5/h4 tie control) is preserved.
 */
const MODEL_ROWS: readonly Holding[] = Object.freeze([
  ...ROOT_ROWS,
  { id: "h8", team: "Alpha", score: 5, note: "zulu", label: "u" },
]);

const MODEL_SOURCE_ORDER = [...SOURCE_VISIBLE_ORDER, "h8"] as const;
const MODEL_OLD_ORDER = [...OLD_VISIBLE_ORDER, "h8"] as const;
const MODEL_NEW_ORDER = [...NEW_VISIBLE_ORDER, "h8"] as const;
const MODEL_SCORE_ASC_ORDER = [
  "h8",
  "h2",
  "h6",
  "h4",
  "h1",
  "h7",
  "h5",
] as const;

type AnyModel = ReturnType<typeof createInstrumentedLocalRowModel>["model"];

function snapshotIds(model: {
  getState(): { snapshot: { range(a: number, b: number): readonly unknown[] } };
}): readonly string[] {
  return model
    .getState()
    .snapshot.range(0, Number.MAX_SAFE_INTEGER)
    .flatMap((row) =>
      (row as { kind: string }).kind === "data"
        ? [String((row as { rowId: unknown }).rowId)]
        : [],
    );
}

describe("setQuery sort-only fast path", () => {
  /**
   * Ticking clock + 1ms budget force the cooperative path to yield after
   * every unit, so any scheduler entry is proof the cooperative machinery
   * ran — and an empty queue is proof the fast path bypassed it.
   */
  function createModelFixture(options?: {
    readonly columns?: FixtureColumns;
    readonly rows?: readonly Holding[];
  }) {
    const scheduler = new ManualScheduler();
    const fixture = createFixture();
    let tick = 0;
    const instrumented = createInstrumentedLocalRowModel({
      rows: options?.rows ?? MODEL_ROWS,
      columns: options?.columns ?? fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    const model = instrumented.model;
    // Fixture controls: three pairwise-distinct permutations of one row set,
    // and the tied pair's id order opposes its source order.
    expect(snapshotIds(model)).toEqual([...MODEL_OLD_ORDER]);
    expect([...MODEL_OLD_ORDER]).not.toEqual([...MODEL_NEW_ORDER]);
    expect([...MODEL_OLD_ORDER]).not.toEqual([...MODEL_SOURCE_ORDER]);
    expect([...MODEL_NEW_ORDER]).not.toEqual([...MODEL_SOURCE_ORDER]);
    expect([...MODEL_OLD_ORDER].sort()).toEqual([...MODEL_NEW_ORDER].sort());
    expect(MODEL_SOURCE_ORDER.indexOf("h5")).toBeLessThan(
      MODEL_SOURCE_ORDER.indexOf("h4"),
    );
    expect(compareOrderStatisticTreeIds("h4", "h5")).toBeLessThan(0);
    return {
      model,
      diagnostics: instrumented.diagnostics,
      scheduler,
      fixture,
    };
  }

  test("resolves synchronously without any scheduler task", async () => {
    const { model, diagnostics, scheduler } = createModelFixture();

    const transition = model.setQuery(NOTE_ASC_TEAM_FILTER);

    expect(scheduler.entries).toHaveLength(0);
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(1);
    await expect(transition.finished).resolves.toBe(1);
  });

  test("mutation twin: a combined sort+filter change takes the cooperative path", () => {
    const { model, diagnostics, scheduler } = createModelFixture();

    // Was a filter-only change until the filter fast path landed; BOTH
    // facets must now change for the cooperative machinery to be the
    // subject.
    model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });

    expect(
      scheduler.entries.length > 0 ||
        model.getState().status.kind === "rebuilding",
    ).toBe(true);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(0);
  });

  test("sorting still sorts: full permutation, ties by source order", () => {
    const { model } = createModelFixture();

    model.setQuery(NOTE_ASC_TEAM_FILTER);

    const ids = snapshotIds(model);
    expect(ids).toEqual([...MODEL_NEW_ORDER]);
    // The note-tied pair resolves by SOURCE order (h5 before h4), which is
    // the opposite of its id order — asserted as a fixture control above.
    expect(ids.indexOf("h5")).toBeLessThan(ids.indexOf("h4"));
  });

  test("supersedes an in-flight cooperative transition", async () => {
    const { model, scheduler } = createModelFixture();
    const first = model.setQuery({
      // Filter AND sort change: a filter-only change would now commit
      // synchronously (filter fast path) and leave nothing to supersede.
      filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    expect(model.getState().status.kind).toBe("rebuilding");

    const second = model.setQuery(NOTE_ASC_TEAM_FILTER);

    await expect(first.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
      reason: "superseded",
    });
    await expect(first.finished).rejects.toBeInstanceOf(
      PretableTransitionCancelledError,
    );
    await expect(second.finished).resolves.toBe(1);
    // The fast path rebuilt from the last COMMITTED root: OLD filter (Alpha)
    // + NEW sort. Every Alpha row the abandoned Beta filter would have
    // removed is still present, and h3 (Beta) is still filtered out.
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);
    expect(model.getState().status).toEqual({ kind: "ready" });
    scheduler.flushAll();
    // Abandoned cooperative tasks must not resurrect the superseded query.
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);
  });

  test("notifies subscribers exactly once", () => {
    const { model } = createModelFixture();
    let calls = 0;
    model.subscribe(() => {
      calls += 1;
    });

    model.setQuery(NOTE_ASC_TEAM_FILTER);

    expect(calls).toBe(1);
  });

  test("snapshot.query and requestedQuery report the new sort", () => {
    const { model } = createModelFixture();

    const transition = model.setQuery(NOTE_ASC_TEAM_FILTER);

    expect(transition.requestedQuery.sort).toEqual([
      { columnId: "note", direction: "asc" },
    ]);
    const snapshot = model.getState().snapshot;
    expect(snapshot.query.sort).toEqual([
      { columnId: "note", direction: "asc" },
    ]);
    expect(snapshot.query.filters).toEqual(SCORE_DESC_TEAM_FILTER.filters);
  });

  test("setRows immediately after a fast setQuery applies incrementally", () => {
    const { model, diagnostics, scheduler } = createModelFixture();
    model.setQuery(NOTE_ASC_TEAM_FILTER);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(1);

    // "aardvark" sorts before every other note, so h6 must move from
    // second-to-last to first under the NEW plan.
    const moved = MODEL_ROWS.map((row) =>
      row.id === "h6" ? { ...row, note: "aardvark" } : row,
    );
    model.setRows(moved);

    expect(snapshotIds(model)).toEqual([
      "h6",
      "h2",
      "h5",
      "h4",
      "h7",
      "h1",
      "h8",
    ]);
    // Parity with normal incremental setRows: synchronous, no scheduler
    // task, no additional whole-root rebuild.
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(scheduler.entries).toHaveLength(0);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(1);
  });

  test('the fast path journals a reset with reason "reorder"', () => {
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;

    model.setQuery(NOTE_ASC_TEAM_FILTER);

    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "reorder",
    });
  });

  test('mutation twin: a cooperative sort+filter setQuery journals "bulk-replace"', async () => {
    const { model, scheduler } = createModelFixture();
    const before = model.getState().snapshot.revision;

    // Was a filter-only change until the filter fast path landed; both
    // facets change so the COOPERATIVE path stays this twin's subject.
    const transition = model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    scheduler.flushAll();
    await expect(transition.finished).resolves.toBe(before + 1);

    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "bulk-replace",
    });
  });

  test('setRows after a fast sort spans a mixed range: NOT "reorder"', () => {
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;
    model.setQuery(NOTE_ASC_TEAM_FILTER);

    const moved = MODEL_ROWS.map((row) =>
      row.id === "h6" ? { ...row, note: "aardvark" } : row,
    );
    model.setRows(moved);

    // The range [reorder barrier, setRows barrier] must NOT collapse to
    // "reorder" — the setRows changed row content, not just order.
    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 2,
      reason: "bulk-replace",
    });
    // And the setRows commit alone is a plain barrier.
    expect(model.changesSince(before + 1)).toEqual({
      kind: "reset",
      toRevision: before + 2,
      reason: "bulk-replace",
    });
  });

  test('same-reference-mutation recompile setRows journals "bulk-replace", never "reorder"', () => {
    // The A2-review-flagged case: the recompile path swaps the plan exactly
    // like the fast path does, but it changes row CONTENT — its barrier must
    // stay a plain one.
    // Non-extensible rows: the dev integrity guard fingerprints them instead
    // of freezing, which is what makes an in-place mutation observable.
    const rows = MODEL_ROWS.map((row) => Object.preventExtensions({ ...row }));
    const { model } = createModelFixture({ rows });
    model.setQuery(NOTE_ASC_TEAM_FILTER);
    const afterSort = model.getState().snapshot.revision;

    // Mutate one row IN PLACE and hand back the same references, which is
    // what forces the same-reference-mutation recompile.
    const mutated = rows.find((row) => row.id === "h6")!;
    mutated.note = "aardvark";
    model.setRows(rows);

    expect(snapshotIds(model)[0]).toBe("h6");
    expect(model.changesSince(afterSort)).toEqual({
      kind: "reset",
      toRevision: afterSort + 1,
      reason: "bulk-replace",
    });
  });

  test("every publicRow carries by identity across the sort-only change", () => {
    const { model } = createModelFixture();
    const snapshotBefore = model.getState().snapshot;
    const before = new Map<string, unknown>();
    for (let index = 0; index < snapshotBefore.visibleRowCount; index += 1) {
      const row = snapshotBefore.rowAt(index)!;
      expect(row.kind).toBe("data");
      if (row.kind === "data") before.set(String(row.rowId), row);
    }

    model.setQuery(NOTE_ASC_TEAM_FILTER);

    const after = model.getState().snapshot;
    expect(after.visibleRowCount).toBe(snapshotBefore.visibleRowCount);
    // Order changed (fixture control: distinct permutations)...
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);
    // ...while every published row object is the SAME object as before —
    // selection/focus consumers keyed by row identity survive the change.
    for (let index = 0; index < after.visibleRowCount; index += 1) {
      const row = after.rowAt(index)!;
      expect(row.kind).toBe("data");
      if (row.kind === "data") {
        expect(row).toBe(before.get(String(row.rowId)));
      }
    }
  });

  test("stale-hazard: key updates re-rank after the fast path, non-key updates do not move", () => {
    const { model, scheduler } = createModelFixture();
    model.setQuery(NOTE_ASC_TEAM_FILTER);
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);

    // A sort-KEY update after the fast path: "aardvark" precedes every other
    // note, so h6 must re-rank from fifth to first. Hand-computed: the
    // remaining rows keep their note-asc relative order.
    const keyUpdated = MODEL_ROWS.map((row) =>
      row.id === "h6" ? { ...row, note: "aardvark" } : row,
    );
    model.setRows(keyUpdated);
    const afterKeyUpdate = ["h6", "h2", "h5", "h4", "h7", "h1", "h8"] as const;
    expect(snapshotIds(model)).toEqual([...afterKeyUpdate]);

    // A NON-key update (label is inactive in every plan): the updated row
    // must NOT move — sameFlatOrder resolves both sides through the store
    // and sees identical keys.
    const nonKeyUpdated = keyUpdated.map((row) =>
      row.id === "h5" ? { ...row, label: "renamed" } : row,
    );
    model.setRows(nonKeyUpdated);
    expect(snapshotIds(model)).toEqual([...afterKeyUpdate]);
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(scheduler.entries).toHaveLength(0);
  });

  test("work counters split carries from evaluations per sort-column entry", () => {
    // Counting contract: `fillSortKeysFromPrevious` bumps ONE counter per
    // (row, next-plan sort column) pair — `sortKeyCarries` when the value
    // came from the previous plan's store, `sortKeyEvaluations` when the
    // accessor ran. Rows already in the next store count nothing.

    // Overlap-heavy: score desc -> score asc shares its single sort column,
    // so every one of the 8 captured rows carries: carries == rowCount,
    // evaluations == 0.
    const overlap = createModelFixture();
    overlap.diagnostics.resetWork();
    overlap.model.setQuery(SCORE_ASC_TEAM_FILTER);
    expect(overlap.diagnostics.read().work.synchronousRebuilds).toBe(1);
    expect(overlap.diagnostics.read().work.sortKeyCarries).toBe(
      MODEL_ROWS.length,
    );
    expect(overlap.diagnostics.read().work.sortKeyEvaluations).toBe(0);

    // New-column: score desc -> note asc has NO overlap; note's accessor
    // runs once per row: evaluations == rowCount, carries == 0.
    const fresh = createModelFixture();
    fresh.diagnostics.resetWork();
    fresh.model.setQuery(NOTE_ASC_TEAM_FILTER);
    expect(fresh.diagnostics.read().work.synchronousRebuilds).toBe(1);
    expect(fresh.diagnostics.read().work.sortKeyEvaluations).toBe(
      MODEL_ROWS.length,
    );
    expect(fresh.diagnostics.read().work.sortKeyCarries).toBe(0);
  });

  test("equivalence with a cold model built directly under the next query", () => {
    const { model: warm, fixture } = createModelFixture();
    warm.setQuery(NOTE_ASC_TEAM_FILTER);
    const cold = createInstrumentedLocalRowModel({
      rows: MODEL_ROWS,
      columns: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    }).model;

    const warmSnapshot = warm.getState().snapshot;
    const coldSnapshot = cold.getState().snapshot;
    expect(warmSnapshot.visibleRowCount).toBe(coldSnapshot.visibleRowCount);
    for (let index = 0; index < warmSnapshot.visibleRowCount; index += 1) {
      const warmRow = warmSnapshot.rowAt(index)!;
      const coldRow = coldSnapshot.rowAt(index)!;
      expect(warmRow.kind).toBe("data");
      expect(warmRow.kind === "data" && coldRow.kind === "data").toBe(true);
      if (warmRow.kind === "data" && coldRow.kind === "data") {
        expect(warmRow.rowId).toBe(coldRow.rowId);
        expect(warmRow.row).toBe(coldRow.row);
      }
    }
    expect(warmSnapshot.query).toEqual(coldSnapshot.query);
  });

  function throwingNoteColumns(boom: Error): FixtureColumns {
    return [
      helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
      helper.accessor("score", (row: Holding) => row.score, {
        type: "number",
        aggregate: "sum",
      }),
      helper.accessor(
        "note",
        (row: Holding): string => {
          // h6 sits sixth in source order, so several rows succeed before the
          // throw — partial work would be visible if state leaked.
          if (row.id === "h6") throw boom;
          return row.note;
        },
        { type: "text" },
      ),
      helper.accessor("label", (row: Holding) => row.label, { type: "text" }),
    ] as unknown as FixtureColumns;
  }

  function expectAccessorFailureShape(
    model: AnyModel,
    transitionId: number,
    boom: Error,
  ): PretableRowModelError {
    const status = model.getState().status;
    expect(status.kind).toBe("error");
    if (status.kind !== "error") throw new Error("unreachable");
    expect(status.transitionId).toBe(transitionId);
    expect(status.error).toBeInstanceOf(PretableRowModelError);
    const error = status.error as PretableRowModelError;
    expect(error.code).toBe("accessor-failed");
    expect(error.cause).toBe(boom);
    return error;
  }

  test("accessor failure on the SLOW path pins the error shape", async () => {
    const boom = new Error("boom");
    const { model, scheduler } = createModelFixture({
      columns: throwingNoteColumns(boom),
    });

    // Filter AND sort change: not sort-only, so the cooperative path runs the
    // throwing accessor.
    const transition = model.setQuery({
      filters: [],
      sort: [{ columnId: "note", direction: "asc" }],
      rowGroups: [],
    });
    scheduler.flushAll();

    const error = expectAccessorFailureShape(model, transition.id, boom);
    await expect(transition.finished).rejects.toBe(error);
    // Root unchanged: the OLD committed order is still published.
    expect(snapshotIds(model)).toEqual([...MODEL_OLD_ORDER]);
  });

  test("accessor failure on the fast path matches the slow path's shape", async () => {
    const boom = new Error("boom");
    const { model, scheduler, diagnostics } = createModelFixture({
      columns: throwingNoteColumns(boom),
    });

    const transition = model.setQuery(NOTE_ASC_TEAM_FILTER);

    // Must not throw synchronously, must not schedule cooperative work.
    expect(scheduler.entries).toHaveLength(0);
    const error = expectAccessorFailureShape(model, transition.id, boom);
    await expect(transition.finished).rejects.toBe(error);
    expect(snapshotIds(model)).toEqual([...MODEL_OLD_ORDER]);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(0);

    // A subsequent valid sort-only setQuery recovers to ready.
    const recovery = model.setQuery({
      filters: SCORE_DESC_TEAM_FILTER.filters,
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    });
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(snapshotIds(model)).toEqual([...MODEL_SCORE_ASC_ORDER]);
    await expect(recovery.finished).resolves.toBe(1);
  });

  test("a reentrant mutation from a sort accessor surfaces the reentrancy error", async () => {
    const modelRef: { current: AnyModel | undefined } = { current: undefined };
    const columns = [
      helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
      helper.accessor("score", (row: Holding) => row.score, {
        type: "number",
        aggregate: "sum",
      }),
      helper.accessor(
        "note",
        (row: Holding): string => {
          if (row.id === "h6") modelRef.current!.setRows([]);
          return row.note;
        },
        { type: "text" },
      ),
      helper.accessor("label", (row: Holding) => row.label, { type: "text" }),
    ] as unknown as FixtureColumns;
    const scheduler = new ManualScheduler();
    const instrumented = createInstrumentedLocalRowModel({
      rows: MODEL_ROWS,
      columns,
      query: SCORE_DESC_TEAM_FILTER,
      transitionScheduler: scheduler,
    });
    modelRef.current = instrumented.model;

    const transition = instrumented.model.setQuery(NOTE_ASC_TEAM_FILTER);

    expect(scheduler.entries).toHaveLength(0);
    const status = instrumented.model.getState().status;
    expect(status.kind).toBe("error");
    if (status.kind !== "error") throw new Error("unreachable");
    expect(status.transitionId).toBe(transition.id);
    expect(status.error).toBeInstanceOf(PretableReentrantMutationError);
    await expect(transition.finished).rejects.toBe(status.error);
    expect(snapshotIds(instrumented.model)).toEqual([...MODEL_OLD_ORDER]);
  });

  test("cancel() on the already-resolved fast transition is a no-op", async () => {
    const { model } = createModelFixture();
    const transition = model.setQuery(NOTE_ASC_TEAM_FILTER);
    await expect(transition.finished).resolves.toBe(1);

    transition.cancel();

    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(snapshotIds(model)).toEqual([...MODEL_NEW_ORDER]);
  });
});

describe("aggregates under the slimmed {sourceOrder} dependency", () => {
  interface Deal {
    id: string;
    team: string;
    score: number;
    note: string;
    label: string;
  }
  const dealHelper = createColumnHelper<Deal>();

  test("sort-key-only updates keep aggregate values correct while re-ranking", () => {
    const columns = [
      dealHelper.accessor("team", { type: "text" }),
      dealHelper.accessor("score", { type: "number", aggregate: "sum" }),
      dealHelper.accessor("note", { type: "text" }),
    ] as const;
    const rows: Deal[] = [
      { id: "r1", team: "A", score: 5, note: "x", label: "u" },
      { id: "r2", team: "A", score: 3, note: "y", label: "u" },
      { id: "r3", team: "B", score: 8, note: "x", label: "u" },
      { id: "r4", team: "B", score: 1, note: "y", label: "u" },
      { id: "r5", team: "A", score: 7, note: "x", label: "u" },
      { id: "r6", team: "B", score: 9, note: "z", label: "u" },
    ];
    const model = createInstrumentedLocalRowModel({
      rows,
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      },
    }).model;
    const shape = () =>
      model
        .getState()
        .snapshot.range(0, 100)
        .map((row) =>
          row.kind === "group"
            ? `group:${String(row.value)}:sum=${String(
                (row.aggregates as { score: unknown }).score,
              )}`
            : String(row.rowId),
        );
    // Hand derivation: A = {r1, r2, r5} sum 15; B = {r3, r4, r6} sum 18.
    // note asc within groups, note ties by source order.
    expect(shape()).toEqual([
      "group:A:sum=15",
      "r1",
      "r5",
      "r2",
      "group:B:sum=18",
      "r3",
      "r4",
      "r6",
    ]);

    // Update ONLY r5's sort key (note). By design the slimmed dependency no
    // longer dirties aggregate leaves for sort-key changes — the sums must
    // still be right (the positive twin), and the row must re-rank.
    model.setRows(
      rows.map((row) => (row.id === "r5" ? { ...row, note: "a" } : row)),
    );
    expect(shape()).toEqual([
      "group:A:sum=15",
      "r5",
      "r1",
      "r2",
      "group:B:sum=18",
      "r3",
      "r4",
      "r6",
    ]);
  });

  test("applyTransaction updating ONLY an aggregated value recomputes that group's sum", () => {
    const columns = [
      dealHelper.accessor("team", { type: "text" }),
      dealHelper.accessor("score", { type: "number", aggregate: "sum" }),
      dealHelper.accessor("note", { type: "text" }),
    ] as const;
    const rows: Deal[] = [
      { id: "r1", team: "A", score: 5, note: "x", label: "u" },
      { id: "r2", team: "A", score: 3, note: "y", label: "u" },
      { id: "r3", team: "B", score: 8, note: "x", label: "u" },
      { id: "r4", team: "B", score: 1, note: "y", label: "u" },
      { id: "r5", team: "A", score: 7, note: "x", label: "u" },
      { id: "r6", team: "B", score: 9, note: "z", label: "u" },
    ];
    const model = createInstrumentedLocalRowModel({
      rows,
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      },
    }).model;
    const shape = () =>
      model
        .getState()
        .snapshot.range(0, 100)
        .map((row) =>
          row.kind === "group"
            ? `group:${String(row.value)}:sum=${String(
                (row.aggregates as { score: unknown }).score,
              )}`
            : String(row.rowId),
        );
    expect(shape()).toEqual([
      "group:A:sum=15",
      "r1",
      "r5",
      "r2",
      "group:B:sum=18",
      "r3",
      "r4",
      "r6",
    ]);

    // Update ONLY r2's aggregated VALUE: score is not sorted and the group
    // key is untouched, so sourceOrder and sort keys are identical before
    // and after — the value comparison in `sameGroupIndexContribution` is
    // the ONLY thing standing between this update and a stale sum.
    model.applyTransaction({ update: [{ id: "r2", changes: { score: 30 } }] });

    expect(shape()).toEqual([
      "group:A:sum=42",
      "r1",
      "r5",
      "r2",
      "group:B:sum=18",
      "r3",
      "r4",
      "r6",
    ]);
  });

  test("aggregate leaves tying on ALL sort keys order by sourceOrder, not id", () => {
    // Order-revealing custom aggregator: concatenates each leaf's label in
    // the aggregate tree's traversal order. Associative (merge preserves
    // left-right order), so the aggregator law holds; NOT commutative, so
    // the output exposes the leaf ordering.
    const concat = {
      init: () => "",
      accumulate: (acc: string, value: string) => acc + value,
      merge: (left: string, right: string) => left + right,
      finalize: (acc: string) => acc,
    };
    const columns = [
      dealHelper.accessor("team", { type: "text" }),
      dealHelper.accessor("score", { type: "number" }),
      dealHelper.accessor("note", { type: "text" }),
      dealHelper.accessor("label", { type: "text", aggregate: concat }),
    ] as const;
    // t3 and t2 tie on the ONLY sort key (note "x"); t3 precedes t2 in
    // source order while its id sorts AFTER t2's — sourceOrder resolution
    // yields "3" before "2", id resolution the opposite. t1 sorts FIRST by
    // note ("m") but LAST in source order, so an ordering that ignores the
    // keys (stale or empty decoration falling through to sourceOrder)
    // produces "321", not "132" — the fixture can disprove key loss, not
    // just tie direction.
    const rows: Deal[] = [
      { id: "t3", team: "A", score: 2, note: "x", label: "3" },
      { id: "t2", team: "A", score: 3, note: "x", label: "2" },
      { id: "t1", team: "A", score: 1, note: "m", label: "1" },
      { id: "t4", team: "B", score: 4, note: "a", label: "4" },
    ];
    const model = createInstrumentedLocalRowModel({
      rows,
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      },
    }).model;

    const groups = model
      .getState()
      .snapshot.range(0, 100)
      .flatMap((row) =>
        row.kind === "group"
          ? [
              `${String(row.value)}:${String(
                (row.aggregates as { label: unknown }).label,
              )}`,
            ]
          : [],
      );
    // A traverses note asc = t1("1"), then the tie by SOURCE order: t3("3")
    // before t2("2").
    expect(groups).toEqual(["A:132", "B:4"]);
  });
});
