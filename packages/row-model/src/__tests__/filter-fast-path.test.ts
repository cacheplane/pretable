import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  PretableRowModelError,
  PretableTransitionCancelledError,
  type PretableQueryFor,
} from "../index";
import {
  compareRecordRows,
  isFilterOnlyChange,
  type CompiledQuery,
} from "../compiled-query";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import { rebuildRootForFilterOnlyChange } from "../filter-rebuild";
import type { RevisionRoot } from "../internal-types";
import { compareOrderStatisticTreeIds } from "../persistent/order-statistic-tree";
import { createPersistentMap } from "../persistent/persistent-map";
import { buildRowStore } from "../row-store";
import type { PretableGroupId } from "../types";
import { createVisibleIndex } from "../visible-index";

interface Holding {
  id: string;
  team: string;
  score: number;
  note: string;
}

const helper = createColumnHelper<Holding>();

/** Checks a query literal against a column tuple, as the sibling suites do. */
function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

function createColumns() {
  return [
    helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
    helper.accessor("score", (row: Holding) => row.score, {
      type: "number",
      aggregate: "sum",
    }),
    helper.accessor("note", (row: Holding) => row.note, { type: "text" }),
  ] as const;
}

type FixtureColumns = ReturnType<typeof createColumns>;

function scoreQuery(
  operator: "gte" | "gt" | "lte",
  value: number,
): PretableQueryFor<FixtureColumns> {
  return queryFor<FixtureColumns>({
    filters: [{ columnId: "score", operator, value }],
    sort: [{ columnId: "note", direction: "asc" }],
    rowGroups: [],
  });
}

const NO_FILTER_QUERY = queryFor<FixtureColumns>({
  filters: [],
  sort: [{ columnId: "note", direction: "asc" }],
  rowGroups: [],
});

/**
 * Eight rows over one sort column (`note`, asc, ties by sourceOrder). Under
 * the main change (score gte 40 -> score lte 60) the survivors are h1/h5/a8
 * and the four flipped-in rows land at the HEAD (h2, note "a"), in the
 * MIDDLE between survivors (h4, note "c"), TIED with a survivor (z4, note
 * "m" against a8), and at the TAIL (h6, note "zz") — the merge cannot pass
 * by appending. The tie pair's id order OPPOSES its source order (z4 comes
 * first in source, a8 sorts first by id), so sourceOrder tie resolution and
 * an id-based one produce opposite orders; both controls are asserted.
 */
const ROOT_ROWS: readonly Holding[] = Object.freeze([
  { id: "h1", team: "Alpha", score: 50, note: "b" },
  { id: "h2", team: "Alpha", score: 30, note: "a" },
  { id: "z4", team: "Alpha", score: 15, note: "m" },
  { id: "h3", team: "Alpha", score: 90, note: "e" },
  { id: "h4", team: "Alpha", score: 35, note: "c" },
  { id: "h5", team: "Alpha", score: 60, note: "d" },
  { id: "a8", team: "Alpha", score: 45, note: "m" },
  { id: "h6", team: "Alpha", score: 10, note: "zz" },
]);

const OLD_VISIBLE_ORDER = ["h1", "h5", "h3", "a8"] as const;
const NEW_VISIBLE_ORDER = ["h2", "h1", "h4", "h5", "z4", "a8", "h6"] as const;
const SURVIVORS = ["h1", "h5", "a8"] as const;
const FLIPPED_IN = ["h2", "z4", "h4", "h6"] as const;
const FLIPPED_OUT = ["h3"] as const;

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

/**
 * Cold oracle: an independently compiled twin plan (cold cache) evaluated
 * from scratch, filtered and sorted with the same composite order the
 * visible tree maintains. Returns the expected visible ids plus the twin's
 * metadata per row so equivalence checks can reach filterPasses and
 * aggregate values.
 */
function coldOracle(
  columns: FixtureColumns,
  query: PretableQueryFor<FixtureColumns>,
  rows: readonly Holding[],
) {
  const twinPlan = compileQuery({ derivations: columns, query });
  const evaluated = rows.map((row, sourceOrder) => ({
    rowId: row.id,
    input: { rowId: row.id, row, sourceOrder },
    metadata: twinPlan.evaluate({ rowId: row.id, row, sourceOrder }),
  }));
  const visibleIds = evaluated
    .filter((entry) => entry.metadata.filterPasses)
    .sort(
      (left, right) =>
        compareRecordRows(twinPlan, left.input, right.input) ||
        compareOrderStatisticTreeIds(left.rowId, right.rowId),
    )
    .map((entry) => entry.rowId);
  return {
    visibleIds,
    metadataOf: new Map(
      evaluated.map((entry) => [entry.rowId, entry.metadata]),
    ),
  };
}

/**
 * Runs the rebuild for `previousQuery -> nextQuery` over `rows` and asserts
 * full equivalence with the cold oracle: visible order (full walk), counts,
 * per-row filterPasses, and per-row aggregate leaf values (filteredLeaf
 * present exactly when passing, carrying the row's real score).
 */
function expectEquivalence(
  previousQuery: PretableQueryFor<FixtureColumns>,
  nextQuery: PretableQueryFor<FixtureColumns>,
  rows: readonly Holding[] = ROOT_ROWS,
) {
  const columns = createColumns();
  const previousPlan = compileQuery({
    derivations: columns,
    query: previousQuery,
  });
  const nextPlan = compileQuery({ derivations: columns, query: nextQuery });
  expect(isFilterOnlyChange(previousPlan, nextPlan)).toBe(true);
  const captured = createRoot(previousPlan, rows);

  const rebuilt = rebuildRootForFilterOnlyChange({
    captured,
    nextPlan,
    revision: 1,
    now: () => 0,
  });

  const oracle = coldOracle(columns, nextQuery, rows);
  expect(rankedIds(rebuilt.visible)).toEqual(oracle.visibleIds);
  expect(rebuilt.visible.rows.size).toBe(oracle.visibleIds.length);
  expect(rebuilt.rows.size).toBe(rows.length);
  for (const row of rows) {
    const record = rebuilt.rows.get(row.id)!;
    const expected = oracle.metadataOf.get(row.id)!;
    expect(record.metadata.filterPasses).toBe(expected.filterPasses);
    const leaf = record.metadata.aggregateLeaves[0]!;
    expect(leaf.allLeaf.value).toBe(row.score);
    if (expected.filterPasses) {
      expect(leaf.filteredLeaf).toBe(leaf.allLeaf);
    } else {
      expect(leaf.filteredLeaf).toBeUndefined();
    }
  }
  return { captured, rebuilt, nextPlan, previousPlan };
}

describe("rebuildRootForFilterOnlyChange", () => {
  function createMainFixture() {
    const columns = createColumns();
    const previousPlan = compileQuery({
      derivations: columns,
      query: scoreQuery("gte", 40),
    });
    const nextPlan = compileQuery({
      derivations: columns,
      query: scoreQuery("lte", 60),
    });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    // Fixture controls. The captured visible order is the hand-derived one;
    // the flipped-in rows interleave with survivors rather than clustering:
    // NEW order must differ from every append shape a broken merge produces.
    expect(rankedIds(captured.visible)).toEqual([...OLD_VISIBLE_ORDER]);
    expect([...NEW_VISIBLE_ORDER]).not.toEqual([...SURVIVORS, ...FLIPPED_IN]);
    expect([...NEW_VISIBLE_ORDER]).not.toEqual([...FLIPPED_IN, ...SURVIVORS]);
    // Tie control: z4 and a8 tie on the only sort key (note "m"). Their id
    // order OPPOSES their source order, so sourceOrder resolution (z4 first,
    // pinned by NEW_VISIBLE_ORDER) and id resolution are distinguishable.
    expect(ROOT_ROWS.findIndex((row) => row.id === "z4")).toBeLessThan(
      ROOT_ROWS.findIndex((row) => row.id === "a8"),
    );
    expect(compareOrderStatisticTreeIds("a8", "z4")).toBeLessThan(0);
    return { columns, previousPlan, nextPlan, captured };
  }

  test("disjoint flip in both directions matches the cold model", () => {
    const { rebuilt } = expectEquivalence(
      scoreQuery("gte", 40),
      scoreQuery("lte", 60),
    );
    // The oracle-derived order is the hand-derived merge fixture order.
    expect(rankedIds(rebuilt.visible)).toEqual([...NEW_VISIBLE_ORDER]);
  });

  test("narrowing matches the cold model", () => {
    expectEquivalence(scoreQuery("gte", 40), scoreQuery("gte", 50));
  });

  test("widening matches the cold model", () => {
    expectEquivalence(scoreQuery("gte", 40), scoreQuery("gte", 20));
  });

  test("removing every filter matches the cold model", () => {
    const { rebuilt } = expectEquivalence(
      scoreQuery("gte", 40),
      NO_FILTER_QUERY,
    );
    expect(rebuilt.visible.rows.size).toBe(ROOT_ROWS.length);
  });

  test("filter-to-empty: every row flips out", () => {
    const { rebuilt, captured } = expectEquivalence(
      scoreQuery("gte", 40),
      scoreQuery("gte", 1000),
    );
    expect(rebuilt.visible.rows.size).toBe(0);
    expect(captured.visible.rows.size).toBe(OLD_VISIBLE_ORDER.length);
  });

  test("empty-to-filter: rows flip into an empty visible set", () => {
    const { rebuilt, captured } = expectEquivalence(
      scoreQuery("gte", 1000),
      scoreQuery("lte", 60),
    );
    expect(captured.visible.rows.size).toBe(0);
    expect(rankedIds(rebuilt.visible)).toEqual([...NEW_VISIBLE_ORDER]);
  });

  test("multi-filter: one of two filters changes, the other keeps failing rows out", () => {
    const rows = Object.freeze([
      ...ROOT_ROWS,
      // Passes each score filter it meets, always fails the team filter —
      // its verdict is false on BOTH sides, so it must stay out AND carry.
      { id: "h9", team: "Beta", score: 50, note: "aa" },
    ]);
    const multi = (
      operator: "gte" | "lte",
      value: number,
    ): PretableQueryFor<FixtureColumns> =>
      queryFor<FixtureColumns>({
        filters: [
          { columnId: "team", operator: "equals", value: "Alpha" },
          { columnId: "score", operator, value },
        ],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      });
    const { captured, rebuilt } = expectEquivalence(
      multi("gte", 40),
      multi("lte", 60),
      rows,
    );
    expect(rebuilt.visible.rows.rankOf("h9")).toBeUndefined();
    // The unflipped failing row carries by identity.
    expect(rebuilt.rows.get("h9")).toBe(captured.rows.get("h9"));
  });

  test("zero flips: new revision root, rows map and visible tree carried by identity", () => {
    const columns = createColumns();
    const previousPlan = compileQuery({
      derivations: columns,
      query: scoreQuery("gte", 40),
    });
    // gt 39 differs as a FILTER (operator and value) but produces identical
    // verdicts over integer scores: filtersChanged is true, flips are zero.
    const nextPlan = compileQuery({
      derivations: columns,
      query: scoreQuery("gt", 39),
    });
    expect(isFilterOnlyChange(previousPlan, nextPlan)).toBe(true);
    const captured = createRoot(previousPlan, ROOT_ROWS);
    const instrumentation = testInstrumentation();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 3,
      now: () => 0,
      instrumentation,
    });

    // Decided and pinned: a zero-flip change still publishes a NEW root at
    // the requested revision under the NEW plan — only the persistent
    // structures carry wholesale, including the visible tree OBJECT.
    expect(rebuilt).not.toBe(captured);
    expect(rebuilt.revision).toBe(3);
    expect(rebuilt.parentRevision).toBe(2);
    expect(rebuilt.queryPlan).toBe(nextPlan);
    expect(rebuilt.cause).toEqual({ kind: "set-query" });
    expect(rebuilt.rows).toBe(captured.rows);
    expect(rebuilt.visible.rows).toBe(captured.visible.rows);
    expect(rankedIds(rebuilt.visible)).toEqual([...OLD_VISIBLE_ORDER]);
    expect(instrumentation.work.filterRebuilds).toBe(1);
    expect(instrumentation.work.filterRowsFlipped).toBe(0);
    expect(instrumentation.work.filterMergeSortedInsertions).toBe(0);
  });

  test("unflipped records carry by identity; flipped records are new", () => {
    const { nextPlan, captured } = createMainFixture();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // Flips exist, so the rows map root must change.
    expect(rebuilt.rows).not.toBe(captured.rows);
    const unflipped = ROOT_ROWS.map((row) => row.id).filter(
      (id) =>
        !FLIPPED_IN.includes(id as never) && !FLIPPED_OUT.includes(id as never),
    );
    expect(unflipped).toEqual([...SURVIVORS]);
    for (const id of unflipped) {
      expect(rebuilt.rows.get(id)).toBe(captured.rows.get(id));
    }
    for (const id of [...FLIPPED_IN, ...FLIPPED_OUT]) {
      const before = captured.rows.get(id)!;
      const after = rebuilt.rows.get(id)!;
      expect(after).not.toBe(before);
      // Everything except metadata carries by reference on a flipped record.
      expect(after.row).toBe(before.row);
      expect(after.publicRow).toBe(before.publicRow);
      expect(after.integrity).toBe(before.integrity);
      expect(after.sourceOrder).toBe(before.sourceOrder);
      expect(after.metadata.groupPath).toBe(before.metadata.groupPath);
    }
    // sourceOrder and expansion carry by reference from the captured root.
    expect(rebuilt.sourceOrder).toBe(captured.sourceOrder);
    expect(rebuilt.expansion).toBe(captured.expansion);
  });

  test("flipped records get the correct filteredLeaf around a CARRIED dependency", () => {
    const { nextPlan, captured } = createMainFixture();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    for (const id of FLIPPED_IN) {
      const before = captured.rows.get(id)!.metadata.aggregateLeaves[0]!;
      const after = rebuilt.rows.get(id)!.metadata.aggregateLeaves[0]!;
      expect(rebuilt.rows.get(id)!.metadata.filterPasses).toBe(true);
      // Flipped in: filteredLeaf appears, and it is the carried allLeaf.
      expect(before.filteredLeaf).toBeUndefined();
      expect(after.filteredLeaf).toBe(after.allLeaf);
      expect(after.allLeaf).toBe(before.allLeaf);
      expect(after.allLeaf.dependency).toBe(before.allLeaf.dependency);
    }
    for (const id of FLIPPED_OUT) {
      const before = captured.rows.get(id)!.metadata.aggregateLeaves[0]!;
      const after = rebuilt.rows.get(id)!.metadata.aggregateLeaves[0]!;
      expect(rebuilt.rows.get(id)!.metadata.filterPasses).toBe(false);
      // Flipped out: filteredLeaf disappears; the allLeaf still carries.
      expect(before.filteredLeaf).toBe(before.allLeaf);
      expect(after.filteredLeaf).toBeUndefined();
      expect(after.allLeaf).toBe(before.allLeaf);
      expect(after.allLeaf.dependency).toBe(before.allLeaf.dependency);
    }
  });

  test("still-passing rows reuse their tree ENTRY objects; flipped-in entries hold the new records", () => {
    const { nextPlan, captured } = createMainFixture();
    const before = new Map(
      [...captured.visible.rows.entries()].map((entry) => [
        entry.record.rowId,
        entry,
      ]),
    );

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    for (const entry of rebuilt.visible.rows.entries()) {
      const id = entry.record.rowId;
      if (SURVIVORS.includes(id as never)) {
        // A still-passing row is by definition unflipped: same entry object.
        expect(entry).toBe(before.get(id));
      } else {
        expect(before.has(id)).toBe(false);
        expect(entry.record).toBe(rebuilt.rows.get(id));
      }
    }
  });

  test("counters: flipped, merge insertions, carries, and wall time are exact", () => {
    const { nextPlan, captured } = createMainFixture();
    const instrumentation = testInstrumentation();
    const ticks = [0, 7];
    let call = 0;

    rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => ticks[call++] ?? 7,
      instrumentation,
    });

    // Hand-counted: h3 flips out; h2, z4, h4, h6 flip in.
    expect(instrumentation.work.filterRebuilds).toBe(1);
    expect(instrumentation.work.filterRowsFlipped).toBe(
      FLIPPED_IN.length + FLIPPED_OUT.length,
    );
    expect(instrumentation.work.filterMergeSortedInsertions).toBe(
      FLIPPED_IN.length,
    );
    expect(instrumentation.work.filterRebuildMs).toBe(7);
    // A filter-only change carries EVERY sort column: one carry per row,
    // zero accessor evaluations, and no sort-path rebuild counted.
    expect(instrumentation.work.sortKeyCarries).toBe(ROOT_ROWS.length);
    expect(instrumentation.work.sortKeyEvaluations).toBe(0);
    expect(instrumentation.work.synchronousRebuilds).toBe(0);
  });

  test("throws TypeError when the plans are not a filter-only change", () => {
    const { columns, captured } = createMainFixture();
    const sortAlsoChangedPlan = compileQuery({
      derivations: columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "score", operator: "lte", value: 60 }],
        sort: [{ columnId: "note", direction: "desc" }],
        rowGroups: [],
      }),
    });

    expect(() =>
      rebuildRootForFilterOnlyChange({
        captured,
        nextPlan: sortAlsoChangedPlan,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError(
        "Synchronous filter rebuild requires a filter-only plan change.",
      ),
    );
  });

  test("throws TypeError for a grouped next plan", () => {
    const columns = createColumns();
    const grouped = (
      operator: "gte" | "lte",
      value: number,
    ): PretableQueryFor<FixtureColumns> =>
      queryFor<FixtureColumns>({
        filters: [{ columnId: "score", operator, value }],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
    const groupedPrevious = compileQuery({
      derivations: columns,
      query: grouped("gte", 40),
    });
    const groupedNext = compileQuery({
      derivations: columns,
      query: grouped("lte", 60),
    });
    const captured = createRoot(groupedPrevious, ROOT_ROWS);

    expect(() =>
      rebuildRootForFilterOnlyChange({
        captured,
        nextPlan: groupedNext,
        revision: 1,
        now: () => 0,
      }),
    ).toThrowError(
      new TypeError("Synchronous filter rebuild requires an ungrouped query."),
    );
  });

  test("a throwing filter-column accessor surfaces the accessor-failed shape and touches nothing", () => {
    const boom = new Error("boom");
    // The captured root must already hold h5, so its evaluate must succeed;
    // the accessor arms AFTER the capture and throws only on the rebuild's
    // verdict read. h5 sits sixth in source order, so several rows succeed
    // before the throw — partial work would be visible if state leaked.
    //
    // The throwing accessor belongs to the FIRST (and only) runtime filter,
    // where the fast and slow paths are shape-identical. They deliberately
    // diverge further right: the verdict seam evaluates filter values
    // LAZILY with `every`-short-circuit, so a LATER filter's throwing
    // accessor is skipped whenever an earlier filter already returned false
    // — the eager slow path would have surfaced it. That case is
    // intentional (the row's verdict is decidable without the read) and
    // unreachable from this pin.
    let armed = false;
    const armedColumns = [
      helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
      helper.accessor(
        "score",
        (row: Holding): number => {
          if (armed && row.id === "h5") throw boom;
          return row.score;
        },
        { type: "number", aggregate: "sum" },
      ),
      helper.accessor("note", (row: Holding) => row.note, { type: "text" }),
    ] as unknown as FixtureColumns;
    const armedPrevious = compileQuery({
      derivations: armedColumns,
      query: scoreQuery("gte", 40),
    });
    const armedNext = compileQuery({
      derivations: armedColumns,
      query: scoreQuery("lte", 60),
    });
    const captured = createRoot(armedPrevious, ROOT_ROWS);
    expect(rankedIds(captured.visible)).toEqual([...OLD_VISIBLE_ORDER]);
    armed = true;

    let thrown: unknown;
    try {
      rebuildRootForFilterOnlyChange({
        captured,
        nextPlan: armedNext,
        revision: 1,
        now: () => 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PretableRowModelError);
    const error = thrown as PretableRowModelError;
    expect(error.code).toBe("accessor-failed");
    expect(error.cause).toBe(boom);
    expect(error.columnId).toBe("score");
    expect(error.rowId).toBe("h5");
    // State untouched: the captured root still publishes the OLD world.
    expect(rankedIds(captured.visible)).toEqual([...OLD_VISIBLE_ORDER]);
    for (const row of ROOT_ROWS) {
      expect(captured.rows.get(row.id)!.metadata.filterPasses).toBe(
        row.score >= 40,
      );
    }
  });
});

/**
 * Minimal deterministic scheduler, duplicated from `sort-fast-path.test.ts`
 * (test files here do not import from each other).
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

/** Cooperative vehicle: BOTH facets change, so neither fast path applies. */
const COMBINED_CHANGE = queryFor<FixtureColumns>({
  filters: [{ columnId: "score", operator: "lte", value: 60 }],
  sort: [{ columnId: "note", direction: "desc" }],
  rowGroups: [],
});

describe("setQuery filter-only fast path", () => {
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
    let tick = 0;
    const instrumented = createInstrumentedLocalRowModel({
      rows: options?.rows ?? ROOT_ROWS,
      columns: options?.columns ?? createColumns(),
      query: scoreQuery("gte", 40),
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    const model = instrumented.model;
    expect(snapshotIds(model)).toEqual([...OLD_VISIBLE_ORDER]);
    return { model, diagnostics: instrumented.diagnostics, scheduler };
  }

  test("resolves synchronously without any scheduler task", async () => {
    const { model, diagnostics, scheduler } = createModelFixture();

    const transition = model.setQuery(scoreQuery("lte", 60));

    expect(scheduler.entries).toHaveLength(0);
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(snapshotIds(model)).toEqual([...NEW_VISIBLE_ORDER]);
    expect(diagnostics.read().work.filterRebuilds).toBe(1);
    expect(diagnostics.read().work.synchronousRebuilds).toBe(0);
    await expect(transition.finished).resolves.toBe(1);
  });

  test("mutation twin: a combined sort+filter change takes the cooperative path", () => {
    const { model, diagnostics, scheduler } = createModelFixture();

    model.setQuery(COMBINED_CHANGE);

    expect(
      scheduler.entries.length > 0 ||
        model.getState().status.kind === "rebuilding",
    ).toBe(true);
    expect(diagnostics.read().work.filterRebuilds).toBe(0);
  });

  test("supersedes an in-flight cooperative transition", async () => {
    const { model, scheduler } = createModelFixture();
    const first = model.setQuery(COMBINED_CHANGE);
    expect(model.getState().status.kind).toBe("rebuilding");

    const second = model.setQuery(scoreQuery("lte", 60));

    await expect(first.finished).rejects.toMatchObject({
      name: "PretableTransitionCancelledError",
      reason: "superseded",
    });
    await expect(first.finished).rejects.toBeInstanceOf(
      PretableTransitionCancelledError,
    );
    await expect(second.finished).resolves.toBe(1);
    // The fast path rebuilt from the last COMMITTED root: OLD sort (note
    // asc) + NEW filter. The abandoned note-desc sort must leave no trace.
    expect(snapshotIds(model)).toEqual([...NEW_VISIBLE_ORDER]);
    expect(model.getState().status).toEqual({ kind: "ready" });
    scheduler.flushAll();
    // Abandoned cooperative tasks must not resurrect the superseded query.
    expect(snapshotIds(model)).toEqual([...NEW_VISIBLE_ORDER]);
  });

  test("notifies subscribers exactly once", () => {
    const { model } = createModelFixture();
    let calls = 0;
    model.subscribe(() => {
      calls += 1;
    });

    model.setQuery(scoreQuery("lte", 60));

    expect(calls).toBe(1);
  });

  test("snapshot.query and requestedQuery report the new filters", () => {
    const { model } = createModelFixture();

    const transition = model.setQuery(scoreQuery("lte", 60));

    expect(transition.requestedQuery.filters).toEqual([
      { columnId: "score", operator: "lte", value: 60 },
    ]);
    const snapshot = model.getState().snapshot;
    expect(snapshot.query.filters).toEqual([
      { columnId: "score", operator: "lte", value: 60 },
    ]);
    expect(snapshot.query.sort).toEqual([
      { columnId: "note", direction: "asc" },
    ]);
  });

  test('THE journal pin: the filter fast path journals a plain "bulk-replace" reset, never "reorder"', () => {
    // The highest-stakes assertion in this cycle: a "reorder" barrier tells
    // renderers the row SET is unchanged and only permuted — after a filter
    // change that is false, and acting on it would permute retained rows
    // over a different membership and corrupt layout.
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;

    model.setQuery(scoreQuery("lte", 60));

    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "bulk-replace",
    });
  });

  test('positive twin: a sort-only setQuery on the same model still journals "reorder"', () => {
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;

    model.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 40 }],
      sort: [{ columnId: "note", direction: "desc" }],
      rowGroups: [],
    });

    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "reorder",
    });
  });

  test("setRows immediately after a fast setQuery applies incrementally", () => {
    const { model, diagnostics, scheduler } = createModelFixture();
    model.setQuery(scoreQuery("lte", 60));
    expect(diagnostics.read().work.filterRebuilds).toBe(1);

    // h3 (note "e", score 90) drops to 20: it now passes lte 60 and must
    // insert between h5 ("d") and the "m" tie pair under the NEW plan.
    const moved = ROOT_ROWS.map((row) =>
      row.id === "h3" ? { ...row, score: 20 } : row,
    );
    model.setRows(moved);

    expect(snapshotIds(model)).toEqual([
      "h2",
      "h1",
      "h4",
      "h5",
      "h3",
      "z4",
      "a8",
      "h6",
    ]);
    // Parity with normal incremental setRows: synchronous, no scheduler
    // task, no additional whole-root rebuild.
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(scheduler.entries).toHaveLength(0);
    expect(diagnostics.read().work.filterRebuilds).toBe(1);
  });

  test("equivalence with a cold model built directly under the next query", () => {
    const { model: warm } = createModelFixture();
    warm.setQuery(scoreQuery("lte", 60));
    const cold = createInstrumentedLocalRowModel({
      rows: ROOT_ROWS,
      columns: createColumns(),
      query: scoreQuery("lte", 60),
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

  /**
   * The throwing accessor belongs to the FIRST (and only) runtime filter,
   * where the fast and slow paths are shape-identical (see the module-level
   * failure test for the intentional lazy-evaluation divergence on LATER
   * filters). It arms after mount so the initial build succeeds.
   */
  function armedThrowingFixture(boom: Error) {
    const armedRef = { current: false };
    const columns = [
      helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
      helper.accessor(
        "score",
        (row: Holding): number => {
          if (armedRef.current && row.id === "h5") throw boom;
          return row.score;
        },
        { type: "number", aggregate: "sum" },
      ),
      helper.accessor("note", (row: Holding) => row.note, { type: "text" }),
    ] as unknown as FixtureColumns;
    return { columns, armedRef };
  }

  function expectAccessorFailureShape(
    model: ReturnType<typeof createModelFixture>["model"],
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

  test("predicate accessor failure on the SLOW path pins the error shape", async () => {
    const boom = new Error("boom");
    const { columns, armedRef } = armedThrowingFixture(boom);
    const { model, scheduler } = createModelFixture({ columns });
    armedRef.current = true;

    // Filter AND sort change: not filter-only, so the cooperative path runs
    // the throwing accessor.
    const transition = model.setQuery(COMBINED_CHANGE);
    scheduler.flushAll();

    const error = expectAccessorFailureShape(model, transition.id, boom);
    await expect(transition.finished).rejects.toBe(error);
    // Root unchanged: the OLD committed order is still published.
    expect(snapshotIds(model)).toEqual([...OLD_VISIBLE_ORDER]);
  });

  test("predicate accessor failure on the fast path matches the slow path's shape", async () => {
    const boom = new Error("boom");
    const { columns, armedRef } = armedThrowingFixture(boom);
    const { model, scheduler, diagnostics } = createModelFixture({ columns });
    armedRef.current = true;

    const transition = model.setQuery(scoreQuery("lte", 60));

    // Must not throw synchronously, must not schedule cooperative work.
    expect(scheduler.entries).toHaveLength(0);
    const error = expectAccessorFailureShape(model, transition.id, boom);
    await expect(transition.finished).rejects.toBe(error);
    expect(snapshotIds(model)).toEqual([...OLD_VISIBLE_ORDER]);
    expect(diagnostics.read().work.filterRebuilds).toBe(0);

    // A subsequent valid filter-only setQuery recovers to ready.
    armedRef.current = false;
    const recovery = model.setQuery(scoreQuery("lte", 60));
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(snapshotIds(model)).toEqual([...NEW_VISIBLE_ORDER]);
    await expect(recovery.finished).resolves.toBe(1);
  });
});
