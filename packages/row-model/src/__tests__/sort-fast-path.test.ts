import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  PretableReentrantMutationError,
  PretableRowModelError,
  PretableTransitionCancelledError,
  resortRecordMetadata,
  type PretableQueryFor,
} from "../index";
import type { CompiledQuery } from "../compiled-query";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import type { RevisionRoot } from "../internal-types";
import { compareOrderStatisticTreeIds } from "../persistent/order-statistic-tree";
import { createPersistentMap } from "../persistent/persistent-map";
import { buildRowStore } from "../row-store";
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

const ROW: Holding = {
  id: "r1",
  team: "Alpha",
  score: 10,
  note: "steady",
  label: "unused",
};

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

describe("resortRecordMetadata", () => {
  test("carries sort, filter-verdict, and aggregate values without re-running accessors", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    fixture.teamAccessor.mockClear();
    fixture.scoreAccessor.mockClear();
    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(rebuilt.filterPasses).toBe(previous.filterPasses);
    expect(rebuilt.filterPasses).toBe(true);
    expect(rebuilt.groupPath).toBe(previous.groupPath);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "score", value: 10 }]);
    expect(rebuilt.aggregateLeaves[0].allLeaf.value).toBe(
      previous.aggregateLeaves[0].allLeaf.value,
    );
    // Every retained value must come from the prior metadata, not a re-run.
    expect(fixture.teamAccessor).not.toHaveBeenCalled();
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    // Inactive in BOTH plans, so 0 across setup and rebuild alike.
    expect(fixture.labelAccessor).not.toHaveBeenCalled();
  });

  test("runs the accessor for a newly-active sort column exactly once", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: NOTE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });
    expect(fixture.noteAccessor).toHaveBeenCalledTimes(0);

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(fixture.noteAccessor).toHaveBeenCalledTimes(1);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "note", value: "steady" }]);
  });

  test("aggregate leaves embed the NEW dependency", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 7,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    const leaf = rebuilt.aggregateLeaves[0];
    expect(leaf.allLeaf.dependency.sortKeys).toBe(rebuilt.sortKeys);
    expect(leaf.allLeaf.dependency.sourceOrder).toBe(7);
    expect(rebuilt.sourceOrder).toBe(7);
    expect(leaf.filteredLeaf).toBe(leaf.allLeaf);
  });

  test("filteredLeaf is undefined when the row failed the (unchanged) filter", () => {
    const fixture = createFixture();
    const failingRow: Holding = { ...ROW, team: "Beta" };
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r2",
      row: failingRow,
      sourceOrder: 1,
    });
    expect(previous.filterPasses).toBe(false);

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(rebuilt.filterPasses).toBe(false);
    expect(rebuilt.aggregateLeaves[0].filteredLeaf).toBeUndefined();
  });

  test("seeds the plan's evaluation cache compatibly with evaluate", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);

    expect(resortRecordMetadata(nextPlan, previous)).toBe(rebuilt);
    expect(
      nextPlan.evaluate({ rowId: "r1", row: ROW, sourceOrder: 0 }),
    ).toBe(rebuilt);
  });

  test("accessor failure surfaces the slow path's error shape", () => {
    const boom = new Error("boom");
    const columns = [
      helper.accessor("team", { type: "text" }),
      helper.accessor("score", { type: "number" }),
      helper.accessor(
        "note",
        // Annotated so the throwing accessor still types as a text column;
        // an inferred `never` value type breaks the tuple under typecheck.
        (): string => {
          throw boom;
        },
        { type: "text" },
      ),
      helper.accessor("label", { type: "text" }),
    ] as const;
    const previousPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      }),
    });
    const nextPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      }),
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });

    let caught: unknown;
    try {
      resortRecordMetadata(nextPlan, previous);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PretableRowModelError);
    const error = caught as PretableRowModelError;
    expect(error.code).toBe("accessor-failed");
    expect(error.rowId).toBe("r1");
    expect(error.columnId).toBe("note");
    expect(error.cause).toBe(boom);
  });

  test("TypeError for a foreign plan object", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 0,
    });
    const foreign = {
      query: SCORE_ASC_TEAM_FILTER,
      derivations: fixture.columns,
    };

    expect(() =>
      resortRecordMetadata(foreign as never, previous),
    ).toThrowError(
      new TypeError("Metadata carryover requires a compiled query plan."),
    );
  });

  test("equivalence: carryover deep-equals a cold evaluate under the next plan", () => {
    const fixture = createFixture();
    const previousPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_DESC_TEAM_FILTER,
    });
    const nextPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    // An identical plan compiled WITHOUT `previous` chaining: distinct object,
    // cold cache, so its evaluate takes the full slow path.
    const twinPlan = compileQuery({
      derivations: fixture.columns,
      query: SCORE_ASC_TEAM_FILTER,
    });
    expect(twinPlan).not.toBe(nextPlan);
    const previous = previousPlan.evaluate({
      rowId: "r1",
      row: ROW,
      sourceOrder: 3,
    });

    const rebuilt = resortRecordMetadata(nextPlan, previous);
    const fresh = twinPlan.evaluate({ rowId: "r1", row: ROW, sourceOrder: 3 });

    expect(rebuilt.sortKeys).toEqual(fresh.sortKeys);
    expect(rebuilt.filterPasses).toBe(fresh.filterPasses);
    expect(rebuilt.groupPath).toEqual(fresh.groupPath);
    expect(
      rebuilt.aggregateLeaves.map((leaf) => leaf.allLeaf.value),
    ).toEqual(fresh.aggregateLeaves.map((leaf) => leaf.allLeaf.value));
    expect(
      rebuilt.aggregateLeaves.map((leaf) => leaf.filteredLeaf !== undefined),
    ).toEqual(fresh.aggregateLeaves.map((leaf) => leaf.filteredLeaf !== undefined));
  });
});

/**
 * Seven rows chosen so the three orders that matter are pairwise-distinct
 * permutations (asserted below): source order, score-desc order, note-asc
 * order. `h3` fails the team filter; `h4`/`h5` tie on `note`, and `h5`
 * appears BEFORE `h4` in source order while its id sorts AFTER — so the
 * engine's real tie resolution (compareRows falls through to sourceOrder)
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
    ids.push(visible.rows.entryAt(index)!.rowId);
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
    expect([...OLD_VISIBLE_ORDER].sort()).toEqual([...NEW_VISIBLE_ORDER].sort());
    // Tiebreak control: the note-tied pair's source order OPPOSES its id
    // order, so ties resolved by rowId instead of the engine's sourceOrder
    // fallthrough (compareRows' final clause) cannot pass by luck — and the
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
      metadata: twinPlan.evaluate({ rowId: row.id, row, sourceOrder }),
    }))
      .filter((entry) => entry.metadata.filterPasses)
      .sort(
        (left, right) =>
          twinPlan.compareRows(left.metadata, right.metadata) ||
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
    expect(record!.metadata.filterPasses).toBe(false);
    // Metadata was rebuilt under the NEW plan: sort keys are note, not score.
    expect(record!.metadata.sortKeys).toEqual([
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

  test("publicRow and integrity are carried by reference per record", () => {
    const { nextPlan, captured } = createRebuildFixture();

    const rebuilt = rebuildRootForSortOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    for (const row of ROOT_ROWS) {
      const before = captured.rows.get(row.id)!;
      const after = rebuilt.rows.get(row.id)!;
      expect(after).not.toBe(before);
      expect(after.publicRow).toBe(before.publicRow);
      expect(after.integrity).toBe(before.integrity);
      expect(after.row).toBe(before.row);
      expect(after.sourceOrder).toBe(before.sourceOrder);
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

  test("mutation twin: a filter change takes the cooperative path", () => {
    const { model, diagnostics, scheduler } = createModelFixture();

    model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
      sort: [{ columnId: "score", direction: "desc" }],
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
      filters: [{ columnId: "team", operator: "equals", value: "Beta" }],
      sort: [{ columnId: "score", direction: "desc" }],
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
