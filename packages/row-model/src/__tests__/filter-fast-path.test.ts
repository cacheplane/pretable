import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  createLocalRowModel,
  PretableRowModelError,
  PretableTransitionCancelledError,
  type PretableQueryFor,
} from "../index";
import {
  adoptEvaluationCache,
  compareRecordRows,
  filterVerdict,
  isFilterOnlyChange,
  isSortOnlyChange,
  sortKeysOf,
  type CompiledQuery,
} from "../compiled-query";
import { rowPassesFilter } from "../filter-membership";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import { createInstrumentedLocalRowModel } from "../diagnostics";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import { rebuildRootForFilterOnlyChange } from "../filter-rebuild";
import { rebuildRootForSortOnlyChange } from "../sort-rebuild";
import type { RevisionRoot } from "../internal-types";
import { compareOrderStatisticTreeIds } from "../persistent/order-statistic-tree";
import { createPersistentMap } from "../persistent/persistent-map";
import { buildRowStore } from "../row-store";
import { createSlotAllocator } from "../slot-allocator";
import type { PretableGroupId } from "../types";
import { EMPTY_MEMBERSHIP } from "../membership-bitset";
import { createVisibleIndex, membershipFromFlatTree } from "../visible-index";

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
  const slots = createSlotAllocator();
  const store = buildRowStore<Holding, string, TColumns>({
    rows,
    getRowId: (row) => row.id,
    queryPlan,
    slots,
  });
  const defaultPolicy = Object.freeze({ kind: "expanded" as const });
  const expansion = Object.freeze({
    default: defaultPolicy,
    overrides: createPersistentMap<PretableGroupId, boolean>(),
    state: Object.freeze({ default: defaultPolicy, overrideCount: 0 }),
  });
  const visible = createVisibleIndex(
    store.records,
    queryPlan,
    false,
    expansion.overrides,
  );
  return Object.freeze({
    revision: 0,
    parentRevision: null,
    rows: store.rows,
    sourceOrder: store.sourceOrder,
    recordsBySlot: store.recordsBySlot,
    slotCapacity: slots.capacity,
    // Same rule as the production initial-build site: flat roots index their
    // membership per slot, grouped roots carry the sentinel.
    visibleSlots:
      queryPlan.query.rowGroups.length > 0
        ? EMPTY_MEMBERSHIP
        : membershipFromFlatTree(visible.rows, slots.capacity),
    visible,
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
      slotChunksTouched: 0,
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
 * visible tree maintains. Returns the expected visible ids, the twin's
 * verdict per row, and the twin's metadata per row so equivalence checks can
 * reach aggregate values.
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
    .filter((entry) => filterVerdict(twinPlan, entry.input))
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
    passesOf: new Map(
      evaluated.map((entry) => [
        entry.rowId,
        filterVerdict(twinPlan, entry.input),
      ]),
    ),
  };
}

/**
 * Runs the rebuild for `previousQuery -> nextQuery` over `rows` and asserts
 * full equivalence with the cold oracle: visible order (full walk), counts,
 * every row's verdict READ AS MEMBERSHIP of the rebuilt root, and per-row
 * aggregate leaf values.
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
    // The verdict equivalence is now structural: the rebuilt root agrees with
    // the cold model about who is a member.
    expect(rowPassesFilter(rebuilt, row.id)).toBe(oracle.passesOf.get(row.id));
    const leaf = record.metadata.aggregateLeaves[0]!;
    expect(leaf.allLeaf.value).toBe(row.score);
    // Identity, for EVERY row: a filter-only change reconstructs no record.
    expect(record).toBe(captured.rows.get(row.id));
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

  test("EVERY record carries by identity, flipped ones included, and so does the rows map", () => {
    const { nextPlan, captured } = createMainFixture();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // The headline of this cycle: five rows flip, and the rows HAMT is the
    // captured object itself — no transient was ever opened.
    expect(rebuilt.rows).toBe(captured.rows);
    const flipped = [...FLIPPED_IN, ...FLIPPED_OUT];
    expect(flipped.length).toBeGreaterThan(0);
    for (const row of ROOT_ROWS) {
      expect(rebuilt.rows.get(row.id)).toBe(captured.rows.get(row.id));
    }
    // Positive twin: the carry did NOT come at the cost of the answer — the
    // membership really did change for exactly the flipped rows.
    for (const id of FLIPPED_IN) {
      expect(rowPassesFilter(captured, id)).toBe(false);
      expect(rowPassesFilter(rebuilt, id)).toBe(true);
    }
    for (const id of FLIPPED_OUT) {
      expect(rowPassesFilter(captured, id)).toBe(true);
      expect(rowPassesFilter(rebuilt, id)).toBe(false);
    }
    for (const id of SURVIVORS) {
      expect(rowPassesFilter(captured, id)).toBe(true);
      expect(rowPassesFilter(rebuilt, id)).toBe(true);
    }
    // sourceOrder and expansion carry by reference from the captured root.
    expect(rebuilt.sourceOrder).toBe(captured.sourceOrder);
    expect(rebuilt.expansion).toBe(captured.expansion);
  });

  test("a flipped row's aggregate leaf and its dependency carry untouched", () => {
    const { nextPlan, captured } = createMainFixture();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    for (const id of [...FLIPPED_IN, ...FLIPPED_OUT]) {
      const before = captured.rows.get(id)!.metadata.aggregateLeaves[0]!;
      const after = rebuilt.rows.get(id)!.metadata.aggregateLeaves[0]!;
      // Nothing about the leaf encodes the verdict, so nothing about it
      // changes when the verdict flips.
      expect(after).toBe(before);
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
    // ZERO sort-key work of either kind, which is the point of the
    // adoption: the per-row fill this path used to run reported one carry
    // per row (`ROOT_ROWS.length`) and zero accessor evaluations — a
    // 100%-carry walk, i.e. a walk that produced value-identical copies of
    // arrays the previous plan already held. The next plan now takes the
    // whole store by reference instead, so there is nothing per-row left to
    // count. `evaluationCacheAdoptions` is what pins the replacement, and it
    // is exactly one per rebuild, never per row.
    expect(instrumentation.work.sortKeyCarries).toBe(0);
    expect(instrumentation.work.sortKeyEvaluations).toBe(0);
    expect(instrumentation.work.evaluationCacheAdoptions).toBe(1);
    expect(instrumentation.work.synchronousRebuilds).toBe(0);
  });

  test("the merge commit takes BOTH bulk-build proofs, exactly once", () => {
    const { nextPlan, captured } = createMainFixture();
    const instrumentation = testInstrumentation();

    rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
      instrumentation,
    });

    // One visible tree is built, and it pays for neither the n−1 order
    // verification nor the n-entry byId refill. NARROW flip: 1 leaver and 4
    // arrivals against 7 built entries, so the derivation is the cheap route
    // and is taken.
    expect(FLIPPED_OUT.length + FLIPPED_IN.length).toBeLessThan(
      NEW_VISIBLE_ORDER.length,
    );
    expect(instrumentation.work.bulkOrderVerificationsSkipped).toBe(1);
    expect(instrumentation.work.bulkByIdDerived).toBe(1);
  });

  /**
   * The routing pair. Both fixtures hand the builder an identical, always-on
   * derivation offer; only the flip RATIO differs, and the builder alone
   * decides. The wide case is the shape the S2 target bench measured, where
   * an unconditional derivation ran 37,500 removes to replace 12,500 inserts
   * — three times the work — and cost ~9ms of settle.
   */
  function routeFixture(nextQuery: PretableQueryFor<FixtureColumns>) {
    const columns = createColumns();
    const previousPlan = compileQuery({
      derivations: columns,
      query: NO_FILTER_QUERY,
    });
    const nextPlan = compileQuery({ derivations: columns, query: nextQuery });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    expect(captured.visible.rows.size).toBe(ROOT_ROWS.length);
    const instrumentation = testInstrumentation();
    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
      instrumentation,
    });
    return { captured, rebuilt, instrumentation, nextQuery, columns };
  }

  test("wide flip — more removals than survivors — REFILLS instead of deriving", () => {
    // 8 visible, 5 flip out, 0 flip in: 5 removals against 3 built entries.
    const { rebuilt, instrumentation } = routeFixture(scoreQuery("gte", 50));

    expect(rankedIds(rebuilt.visible)).toEqual(["h1", "h5", "h3"]);
    expect(instrumentation.work.filterRowsFlipped).toBe(5);
    expect(instrumentation.work.filterMergeSortedInsertions).toBe(0);
    expect(instrumentation.work.bulkByIdDerived).toBe(0);
    // The free half of the proof is unaffected by the routing decision.
    expect(instrumentation.work.bulkOrderVerificationsSkipped).toBe(1);
  });

  test("narrow flip — fewer removals than survivors — DERIVES", () => {
    // 8 visible, 1 flips out (h3, score 90), 0 flip in: 1 against 7.
    const { rebuilt, instrumentation } = routeFixture(scoreQuery("lte", 60));

    expect(rankedIds(rebuilt.visible)).toEqual([
      "h2",
      "h1",
      "h4",
      "h5",
      "z4",
      "a8",
      "h6",
    ]);
    expect(instrumentation.work.filterRowsFlipped).toBe(1);
    expect(instrumentation.work.bulkByIdDerived).toBe(1);
    expect(instrumentation.work.bulkOrderVerificationsSkipped).toBe(1);
  });

  test("the two routes produce the same tree, key for key, on the same input", () => {
    // Correctness twin for the pair above: whichever route ran, the result
    // matches a cold model built directly under the next query. Routing is a
    // cost decision and must be invisible in the output.
    for (const nextQuery of [scoreQuery("gte", 50), scoreQuery("lte", 60)]) {
      const { rebuilt, columns } = routeFixture(nextQuery);
      const oracle = coldOracle(columns, nextQuery, ROOT_ROWS);
      expect(rankedIds(rebuilt.visible)).toEqual(oracle.visibleIds);
      const tree = rebuilt.visible.rows;
      expect(tree.size).toBe(oracle.visibleIds.length);
      for (const row of ROOT_ROWS) {
        const visible = oracle.passesOf.get(row.id);
        expect(rowPassesFilter(rebuilt, row.id)).toBe(visible);
        if (visible) {
          const entry = tree.get(row.id)!;
          expect(entry.record.rowId).toBe(row.id);
          // The map and the tree agree — the assertion the refill route gets
          // for free and the derived route has to earn.
          expect(tree.entryAt(tree.rankOf(row.id)!)).toBe(entry);
        } else {
          expect(tree.get(row.id)).toBeUndefined();
        }
      }
    }
  });

  test("zero flips takes NO bulk build at all, so neither proof is claimed", () => {
    const columns = createColumns();
    const previousPlan = compileQuery({
      derivations: columns,
      query: scoreQuery("gte", 40),
    });
    const nextPlan = compileQuery({
      derivations: columns,
      // Same membership, different plan identity: no row flips, so the
      // visible tree carries whole and no builder runs.
      query: scoreQuery("gt", 39),
    });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    const instrumentation = testInstrumentation();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
      instrumentation,
    });

    expect(instrumentation.work.filterRowsFlipped).toBe(0);
    expect(rebuilt.visible).toBe(captured.visible);
    expect(instrumentation.work.bulkOrderVerificationsSkipped).toBe(0);
    expect(instrumentation.work.bulkByIdDerived).toBe(0);
  });

  test("the derived byId agrees with the built tree at every visible id", () => {
    const { nextPlan, captured } = createMainFixture();

    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
    });

    // This is the derived map's whole correctness claim, and the survivors
    // are the half a size check cannot see: `get` must return the SAME entry
    // object the tree holds at that rank, not the captured tree's stale one.
    const tree = rebuilt.visible.rows;
    let survivorsChecked = 0;
    for (let rank = 0; rank < tree.size; rank += 1) {
      const entry = tree.entryAt(rank)!;
      const id = entry.record.rowId;
      expect(tree.get(id)).toBe(entry);
      expect(tree.rankOf(id)).toBe(rank);
      if (SURVIVORS.includes(id as never)) {
        // Reused by identity — the precondition derived mode rides on.
        expect(captured.visible.rows.get(id)).toBe(entry);
        survivorsChecked += 1;
      }
    }
    expect(survivorsChecked).toBe(SURVIVORS.length);
    // The leavers are gone from the map, not merely from the tree.
    for (const id of FLIPPED_OUT) {
      expect(tree.get(id as never)).toBeUndefined();
      expect(tree.rankOf(id as never)).toBeUndefined();
    }
    expect(tree.size).toBe(NEW_VISIBLE_ORDER.length);
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
      expect(rowPassesFilter(captured, row.id)).toBe(row.score >= 40);
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

  test('THE journal pin: the filter fast path journals a "refilter" reset, never "reorder"', () => {
    // The highest-stakes assertion in this cycle: a "reorder" barrier tells
    // renderers the row SET is unchanged and only permuted — after a filter
    // change that is false, and acting on it would permute retained rows
    // over a different membership and corrupt layout. "refilter" makes the
    // opposite promise (membership changed, surviving order and identities
    // did not), which is exactly what the filter fast path delivers.
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;

    model.setQuery(scoreQuery("lte", 60));

    const sequence = model.changesSince(before);
    expect(sequence).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "refilter",
    });
    // The load-bearing half, kept explicit: whatever the reason evolves
    // into, it must never be "reorder" for a membership change.
    if (sequence.kind === "reset") {
      expect(sequence.reason).not.toBe("reorder");
    }
  });

  test('mutation twin: a cooperative combined change journals "bulk-replace"', async () => {
    const { model, scheduler } = createModelFixture();
    const before = model.getState().snapshot.revision;

    const transition = model.setQuery(COMBINED_CHANGE);
    scheduler.flushAll();
    await expect(transition.finished).resolves.toBe(before + 1);

    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 1,
      reason: "bulk-replace",
    });
  });

  test('setRows after a fast filter spans a mixed range: NOT "refilter"', () => {
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;
    model.setQuery(scoreQuery("lte", 60));

    const moved = ROOT_ROWS.map((row) =>
      row.id === "h3" ? { ...row, score: 20 } : row,
    );
    model.setRows(moved);

    // The range [refilter barrier, setRows barrier] must NOT collapse to
    // "refilter" — the setRows changed row content, not just membership.
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

  test('a fast filter then a fast sort spans a mixed range: "bulk-replace"', () => {
    const { model } = createModelFixture();
    const before = model.getState().snapshot.revision;

    model.setQuery(scoreQuery("lte", 60));
    model.setQuery({
      filters: [{ columnId: "score", operator: "lte", value: 60 }],
      sort: [{ columnId: "note", direction: "desc" }],
      rowGroups: [],
    });

    // Neither promise holds over the whole range (membership changed AND
    // order changed), so the aggregate degrades to the plain bulk reset —
    // while each single-commit range keeps its own reason.
    expect(model.changesSince(before)).toEqual({
      kind: "reset",
      toRevision: before + 2,
      reason: "bulk-replace",
    });
    expect(model.changesSince(before + 1)).toEqual({
      kind: "reset",
      toRevision: before + 2,
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

  test("order independence: slot reuse never leaks into the visible order", () => {
    // Transaction history engineered so slot order ≠ source order ≠ visible
    // order: build A,B,C,D (slots 0..3), remove B (slot 1 freed), add E (E
    // takes B's slot, so it sits between A and C in SLOT order while sitting
    // last in SOURCE order). A filter-only setQuery then flips A out and E
    // in. This is the pin that fails if anyone later makes the rebuild's
    // walk order-sensitive.
    const rowA = { id: "A", team: "Alpha", score: 50, note: "d" };
    const rowB = { id: "B", team: "Alpha", score: 10, note: "x" };
    const rowC = { id: "C", team: "Alpha", score: 44, note: "b" };
    const rowD = { id: "D", team: "Alpha", score: 41, note: "a" };
    const rowE = { id: "E", team: "Alpha", score: 30, note: "c" };
    const instrumented = createInstrumentedLocalRowModel({
      rows: [rowA, rowB, rowC, rowD],
      columns: createColumns(),
      query: scoreQuery("gte", 40),
      getRowId: (row: Holding) => row.id,
    });
    const model = instrumented.model;
    const internals = () => getLocalRowModelSlotInternalsForTesting(model);
    const slotOf = (id: string) => internals().root.rows.get(id)!.slot;
    const bSlot = slotOf("B");
    model.setRows([rowA, rowC, rowD]);
    model.setRows([rowA, rowC, rowD, rowE]);
    // Precondition, asserted so the pin cannot go vacuous: E really does
    // reuse B's released slot, so E precedes C and D in slot order while
    // following them in source order.
    expect(slotOf("E")).toBe(bSlot);
    expect(slotOf("E")).toBeLessThan(slotOf("C"));

    const transition = model.setQuery(scoreQuery("lte", 45));

    // The fast path ran (the pin exercises the rebuild, not a fallback)…
    expect(instrumented.diagnostics.read().work.filterRebuilds).toBe(1);
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(transition.id).toBeGreaterThan(0);
    // …and the visible sequence is EXACTLY what a freshly-built model with
    // the same final rows and query publishes — slot history invisible.
    const fresh = createInstrumentedLocalRowModel({
      rows: [rowA, rowC, rowD, rowE],
      columns: createColumns(),
      query: scoreQuery("lte", 45),
      getRowId: (row: Holding) => row.id,
    }).model;
    expect(snapshotIds(model)).toEqual(snapshotIds(fresh));
    expect(snapshotIds(model)).toEqual(["D", "C", "E"]);
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

/**
 * The adoption is a CACHE-SHARING change: after a filter-only rebuild the
 * next plan reads the previous plan's evaluation cache by reference. These
 * tests hold the two halves of that bargain — the shared fields really are
 * valid under the new plan, and the one field that is NOT (the verdict memo)
 * never answers for the adopter — plus every chain that composes adoption
 * with another path.
 */
describe("evaluation-cache adoption", () => {
  /** Columns whose accessors are spies, so "no re-read" is observable. */
  function spyColumns() {
    const teamAccessor = vi.fn((row: Holding) => row.team);
    const scoreAccessor = vi.fn((row: Holding) => row.score);
    const noteAccessor = vi.fn((row: Holding) => row.note);
    const columns = [
      helper.accessor("team", teamAccessor, { type: "text" }),
      helper.accessor("score", scoreAccessor, {
        type: "number",
        aggregate: "sum",
      }),
      helper.accessor("note", noteAccessor, { type: "text" }),
    ] as unknown as FixtureColumns;
    return { columns, teamAccessor, scoreAccessor, noteAccessor };
  }

  function adoptedFixture(
    previousQuery: PretableQueryFor<FixtureColumns> = scoreQuery("gte", 40),
    nextQuery: PretableQueryFor<FixtureColumns> = scoreQuery("lte", 60),
  ) {
    const spies = spyColumns();
    const previousPlan = compileQuery({
      derivations: spies.columns,
      query: previousQuery,
    });
    const nextPlan = compileQuery({
      derivations: spies.columns,
      query: nextQuery,
    });
    const captured = createRoot(previousPlan, ROOT_ROWS);
    const instrumentation = testInstrumentation();
    const rebuilt = rebuildRootForFilterOnlyChange({
      captured,
      nextPlan,
      revision: 1,
      now: () => 0,
      instrumentation,
    });
    expect(instrumentation.work.evaluationCacheAdoptions).toBe(1);
    return { ...spies, previousPlan, nextPlan, captured, rebuilt };
  }

  /** The input triple `evaluate` was originally called with, for one row. */
  function inputFor(rowId: string) {
    const sourceOrder = ROOT_ROWS.findIndex((row) => row.id === rowId);
    return { rowId, row: ROOT_ROWS[sourceOrder], sourceOrder };
  }

  test("an adopted metadata hit is CORRECT under the new plan and re-reads nothing", () => {
    const fixture = adoptedFixture();
    // h1 survives the flip untouched — the case most likely to be served
    // from the adopted entry rather than recomputed.
    const input = inputFor("h1");
    // The oracle runs the same spy accessors, so build it BEFORE clearing.
    const oracle = coldOracle(fixture.columns, scoreQuery("lte", 60), [
      ...ROOT_ROWS,
    ]);
    fixture.teamAccessor.mockClear();
    fixture.scoreAccessor.mockClear();
    fixture.noteAccessor.mockClear();

    const metadata = fixture.nextPlan.evaluate(input);

    // Content, not identity: what the NEW plan promises for this row.
    expect(metadata.rowId).toBe("h1");
    expect(metadata.row).toBe(input.row);
    expect(metadata.sourceOrder).toBe(input.sourceOrder);
    expect(metadata.groupPath).toEqual([]);
    expect(
      metadata.aggregateLeaves.map((leaf) => ({
        columnId: leaf.columnId,
        value: leaf.allLeaf.value,
        dependency: leaf.allLeaf.dependency,
      })),
    ).toEqual([
      {
        columnId: "score",
        value: 50,
        dependency: {
          sourceOrder: input.sourceOrder,
          sortKeys: [{ columnId: "note", value: "b" }],
        },
      },
    ]);
    // …and against an independently compiled COLD twin of the new plan.
    expect(metadata).toEqual(oracle.metadataOf.get("h1"));
    // The whole point of the adoption: zero accessor work on the hit.
    expect(fixture.teamAccessor).not.toHaveBeenCalled();
    expect(fixture.scoreAccessor).not.toHaveBeenCalled();
    expect(fixture.noteAccessor).not.toHaveBeenCalled();
  });

  test("an adopted entry's VERDICT memo never answers for the adopting plan", () => {
    // h3 passes `gte 40` (score 90) and fails `lte 60`: if the adopted memo
    // leaked, the new plan would report the old verdict for it.
    const fixture = adoptedFixture();
    const input = inputFor("h3");
    expect(filterVerdict(fixture.previousPlan, input)).toBe(true);
    fixture.scoreAccessor.mockClear();

    expect(filterVerdict(fixture.nextPlan, input)).toBe(false);
    // Proof it was recomputed rather than remembered: the filter column's
    // accessor ran. (An adopting plan pays exactly the pass it paid before
    // the adoption existed — the memo was never available to it.)
    expect(fixture.scoreAccessor).toHaveBeenCalledTimes(1);
    // The previous plan keeps its own memo: sharing is symmetric-safe.
    expect(filterVerdict(fixture.previousPlan, input)).toBe(true);
  });

  test("the adopted store hands back the previous plan's key arrays BY IDENTITY", () => {
    const fixture = adoptedFixture();
    for (const row of ROOT_ROWS) {
      const input = inputFor(row.id);
      const previousKeys = sortKeysOf(fixture.previousPlan, input);
      // Identity, not equality: the adoption's entire saving is that no new
      // array is produced for any row.
      expect(sortKeysOf(fixture.nextPlan, input)).toBe(previousKeys);
    }
    // And the entries the rebuild put in the tree carry those same arrays.
    for (const entry of fixture.rebuilt.visible.rows.entries()) {
      expect(entry.keys).toBe(
        sortKeysOf(fixture.previousPlan, inputFor(entry.record.rowId)),
      );
    }
  });

  test("chain: filter change, then a sort-only change over the ADOPTED cache", () => {
    const fixture = adoptedFixture();
    const sortedPlan = compileQuery({
      derivations: fixture.columns,
      query: queryFor<FixtureColumns>({
        filters: [{ columnId: "score", operator: "lte", value: 60 }],
        sort: [{ columnId: "note", direction: "desc" }],
        rowGroups: [],
      }),
    });
    expect(isSortOnlyChange(fixture.rebuilt.queryPlan, sortedPlan)).toBe(true);

    const resorted = rebuildRootForSortOnlyChange({
      captured: fixture.rebuilt,
      nextPlan: sortedPlan,
      revision: 2,
      now: () => 0,
    });

    // The sort path fills its OWN store from the adopted one, so the new
    // plan's keys are fresh objects with the same values, and the order is
    // the cold model's — note DESC, with the z4/a8 tie still broken by
    // sourceOrder (a reversal of the asc order would swap them).
    const oracle = coldOracle(
      fixture.columns,
      queryFor<FixtureColumns>({
        filters: [{ columnId: "score", operator: "lte", value: 60 }],
        sort: [{ columnId: "note", direction: "desc" }],
        rowGroups: [],
      }),
      [...ROOT_ROWS],
    );
    expect(rankedIds(resorted.visible)).toEqual(oracle.visibleIds);
    expect(oracle.visibleIds).not.toEqual([...NEW_VISIBLE_ORDER].reverse());
    for (const row of ROOT_ROWS) {
      const input = inputFor(row.id);
      expect(sortKeysOf(sortedPlan, input)).toEqual([
        { columnId: "note", value: row.note },
      ]);
      // Fresh arrays: a sort change is exactly the change that may NOT share.
      expect(sortKeysOf(sortedPlan, input)).not.toBe(
        sortKeysOf(fixture.nextPlan, input),
      );
    }
  });

  test("chain: a filter change adopting an ALREADY-adopted cache", () => {
    const fixture = adoptedFixture();
    const thirdPlan = compileQuery({
      derivations: fixture.columns,
      query: scoreQuery("gte", 20),
    });
    const instrumentation = testInstrumentation();

    const third = rebuildRootForFilterOnlyChange({
      captured: fixture.rebuilt,
      nextPlan: thirdPlan,
      revision: 2,
      now: () => 0,
      instrumentation,
    });

    expect(instrumentation.work.evaluationCacheAdoptions).toBe(1);
    expect(instrumentation.work.sortKeyCarries).toBe(0);
    const oracle = coldOracle(fixture.columns, scoreQuery("gte", 20), [
      ...ROOT_ROWS,
    ]);
    expect(rankedIds(third.visible)).toEqual(oracle.visibleIds);
    for (const row of ROOT_ROWS) {
      expect(rowPassesFilter(third, row.id)).toBe(oracle.passesOf.get(row.id));
      // Still the FIRST plan's arrays: the map is the same object throughout.
      expect(sortKeysOf(thirdPlan, inputFor(row.id))).toBe(
        sortKeysOf(fixture.previousPlan, inputFor(row.id)),
      );
    }
  });

  test("chain: filter change, then a same-reference mutation recompile", () => {
    // The A2 rebuild-or-reseed invariant, run against an ADOPTED cache: the
    // recompile is a plan swap whose fresh store is seeded from the plan
    // that adopted, and the visible index must be rebuilt under the fresh
    // plan so the mutated row re-ranks.
    const mutable = Object.preventExtensions({
      id: "m1",
      team: "Alpha",
      score: 10,
      note: "b",
    });
    const other = { id: "m2", team: "Alpha", score: 20, note: "c" };
    const third = { id: "m3", team: "Alpha", score: 30, note: "a" };
    const model = createLocalRowModel({
      rows: [mutable, other, third],
      columns: createColumns(),
      query: scoreQuery("gte", 0),
      getRowId: (row) => row.id,
    });
    expect(snapshotIds(model)).toEqual(["m3", "m1", "m2"]);

    // Filter-only change first: this is the adoption.
    model.setQuery(scoreQuery("gte", 15));
    expect(snapshotIds(model)).toEqual(["m3", "m2"]);

    // Now mutate IN PLACE on the sort column and hand back the same refs.
    mutable.score = 99;
    mutable.note = "zz";
    model.setRows([mutable, other, third]);
    expect(snapshotIds(model)).toEqual(["m3", "m2", "m1"]);

    // Follow-up update of a CARRIED row: its previous record must resolve
    // under the recompiled plan's own store, or the fail-loud miss throws.
    model.setRows([mutable, { ...other, note: "zzz" }, third]);
    expect(snapshotIds(model)).toEqual(["m3", "m1", "m2"]);
  });

  test("a row absent from the adopted cache evaluates fresh and correctly", () => {
    const rows = ROOT_ROWS.map((row) => ({ ...row }));
    const model = createLocalRowModel({
      rows,
      columns: createColumns(),
      query: scoreQuery("gte", 40),
      getRowId: (row) => row.id,
    });
    model.setQuery(scoreQuery("lte", 60));
    expect(snapshotIds(model)).toEqual([...NEW_VISIBLE_ORDER]);

    // `n1` was never seen by either plan, so the adopted map has no entry.
    const arrival: Holding = {
      id: "n1",
      team: "Alpha",
      score: 25,
      note: "ba",
    };
    model.setRows([...rows, arrival]);

    // Sorted by note: "ba" sits between "b" (h1) and "c" (h4), and 25 passes
    // `lte 60`, so the newcomer is visible in its own rank.
    expect(snapshotIds(model)).toEqual([
      "h2",
      "h1",
      "n1",
      "h4",
      "h5",
      "z4",
      "a8",
      "h6",
    ]);
  });

  test("a GROUPED model's filter change adopts nothing (it never takes the fast path)", () => {
    const scheduler = new ManualScheduler();
    let tick = 0;
    const groupedQuery = (
      operator: "gte" | "lte",
      value: number,
    ): PretableQueryFor<FixtureColumns> =>
      queryFor<FixtureColumns>({
        filters: [{ columnId: "score", operator, value }],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
    const instrumented = createInstrumentedLocalRowModel({
      rows: ROOT_ROWS,
      columns: createColumns(),
      query: groupedQuery("gte", 40),
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });

    instrumented.model.setQuery(groupedQuery("lte", 60));
    scheduler.flushAll();

    expect(instrumented.diagnostics.read().work.filterRebuilds).toBe(0);
    expect(instrumented.diagnostics.read().work.evaluationCacheAdoptions).toBe(
      0,
    );
    expect(instrumented.model.getState().status).toEqual({ kind: "ready" });
    // The grouped result is still right, which is what "unaffected" means.
    expect(snapshotIds(instrumented.model)).toEqual([
      "h2",
      "h1",
      "h4",
      "h5",
      "z4",
      "a8",
      "h6",
    ]);
  });

  test("adoption requires compiled plans on BOTH sides", () => {
    const fixture = adoptedFixture();
    const foreign = { evaluate: () => undefined } as never;
    expect(() => adoptEvaluationCache(fixture.nextPlan, foreign)).toThrowError(
      new TypeError("Evaluation-cache adoption requires compiled query plans."),
    );
    expect(() =>
      adoptEvaluationCache(foreign, fixture.previousPlan),
    ).toThrowError(
      new TypeError("Evaluation-cache adoption requires compiled query plans."),
    );
  });
});
