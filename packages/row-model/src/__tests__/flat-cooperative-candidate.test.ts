import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "../index";
import type { CooperativeTransitionScheduler } from "../cooperative-transition";
import { getLocalRowModelActiveTransitionCandidateForTesting } from "../create-local-row-model";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import type { PretableRowId } from "../column-types";
import type { RevisionRoot } from "../internal-types";
import { testMembershipBit } from "../membership-bitset";

interface Row {
  id: string;
  team: string;
  score: number;
  note: string;
  rank: number;
}

const helper = createColumnHelper<Row>();

function createColumns() {
  return [
    helper.accessor("team", { type: "text" }),
    helper.accessor("score", { type: "number" }),
    helper.accessor("note", { type: "text" }),
    helper.accessor("rank", { type: "number" }),
  ] as const;
}

type FixtureColumns = ReturnType<typeof createColumns>;

function queryFor(
  value: PretableQueryFor<FixtureColumns>,
): PretableQueryFor<FixtureColumns> {
  return value;
}

/**
 * Every ordering this suite exercises is pairwise DIFFERENT — source order,
 * `note` asc, `rank` asc and `rank` desc all disagree — so a candidate that
 * kept the captured plan's sort keys (or the captured order) cannot settle to
 * the cold model's order. The filter boundary (gte 40 vs lte 60) flips rows
 * in BOTH directions, so a carried verdict is equally detectable.
 */
const FIXTURE_ROWS: readonly Row[] = Object.freeze([
  { id: "a", team: "X", score: 50, note: "b", rank: 5 },
  { id: "b", team: "X", score: 30, note: "a", rank: 1 },
  { id: "c", team: "Y", score: 90, note: "e", rank: 7 },
  { id: "d", team: "Y", score: 35, note: "c", rank: 2 },
  { id: "e", team: "X", score: 60, note: "d", rank: 3 },
  { id: "f", team: "Y", score: 45, note: "m", rank: 8 },
  { id: "g", team: "X", score: 10, note: "zz", rank: 4 },
  { id: "h", team: "Y", score: 70, note: "f", rank: 6 },
]);

const INITIAL_QUERY = queryFor({
  filters: [{ columnId: "score", operator: "gte", value: 40 }],
  sort: [{ columnId: "note", direction: "asc" }],
  rowGroups: [],
});

const FILTER_ONLY_QUERY = queryFor({
  filters: [{ columnId: "score", operator: "lte", value: 60 }],
  sort: [{ columnId: "note", direction: "asc" }],
  rowGroups: [],
});

const SORT_ONLY_QUERY = queryFor({
  filters: [{ columnId: "score", operator: "gte", value: 40 }],
  sort: [{ columnId: "rank", direction: "asc" }],
  rowGroups: [],
});

const COMBINED_QUERY = queryFor({
  filters: [{ columnId: "score", operator: "lte", value: 60 }],
  sort: [{ columnId: "rank", direction: "desc" }],
  rowGroups: [],
});

const GROUPED_QUERY = queryFor({
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "team", direction: "asc" }],
});

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: { readonly task: () => void; cancelled: boolean }[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushOne(): boolean {
    const entry = this.entries.shift();
    if (entry === undefined) return false;
    if (!entry.cancelled) entry.task();
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

/**
 * Ticking clock + 1ms budget: one build/replay unit per slice, so partial
 * flushes leave the candidate observably mid-build. Both fast-path limits are
 * zero so filter-only and sort-only changes go COOPERATIVE on this tiny
 * fixture instead of taking their synchronous rebuilds (#488's gate, in the
 * test-forcing direction).
 */
function createFixture(options?: {
  readonly rows?: readonly Row[];
  readonly query?: PretableQueryFor<FixtureColumns>;
}) {
  const scheduler = new ManualScheduler();
  let tick = 0;
  const model = createLocalRowModel({
    rows: options?.rows ?? FIXTURE_ROWS,
    columns: createColumns(),
    getRowId: (row: Row) => row.id,
    query: options?.query ?? INITIAL_QUERY,
    transitionScheduler: scheduler,
    transitionClock: () => tick++,
    transitionBudgetMs: 1,
    ɵfilterFastPathRowLimit: 0,
    ɵsortFastPathRowLimit: 0,
  });
  return { model, scheduler };
}

function createColdModel(
  rows: readonly Row[],
  query: PretableQueryFor<FixtureColumns>,
) {
  return createLocalRowModel({
    rows,
    columns: createColumns(),
    getRowId: (row: Row) => row.id,
    query,
  });
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

function rootOf(model: object): RevisionRoot<object, PretableRowId, unknown> {
  return getLocalRowModelSlotInternalsForTesting(model).root;
}

/**
 * The flat membership oracle, verbatim from visible-slots.test.ts: a record's
 * bit is set iff the record is a member of `visible.rows`, and the set-bit
 * count over the root's self-described capacity equals the tree's size (so a
 * stale bit on a record-less slot fails too). Skipping the bitset write for
 * one swept row fails here.
 */
function expectMembershipOracle(
  root: RevisionRoot<object, PretableRowId, unknown>,
): void {
  for (const [, record] of root.rows.entries()) {
    expect(testMembershipBit(root.visibleSlots, record.slot)).toBe(
      root.visible.rows.get(record.rowId) !== undefined,
    );
  }
  let setBits = 0;
  for (let slot = 0; slot < root.slotCapacity; slot += 1) {
    if (testMembershipBit(root.visibleSlots, slot)) setBits += 1;
  }
  expect(setBits).toBe(root.visible.rows.size);
}

function expectSettledEqualsCold(
  model: Parameters<typeof snapshotIds>[0] & object,
  coldRows: readonly Row[],
  query: PretableQueryFor<FixtureColumns>,
): void {
  const cold = createColdModel(coldRows, query);
  expect(snapshotIds(model)).toEqual(snapshotIds(cold));
  expect(model.getState().snapshot).toMatchObject({
    sourceRowCount: cold.getState().snapshot.sourceRowCount,
    visibleRowCount: cold.getState().snapshot.visibleRowCount,
  });
  expectMembershipOracle(rootOf(model));
  expectMembershipOracle(rootOf(cold));
  cold.dispose();
}

function activeCandidateOf(model: object): {
  readonly completedRows: number;
  readonly totalRows: number;
} {
  const candidate = getLocalRowModelActiveTransitionCandidateForTesting(model);
  expect(candidate).toBeDefined();
  return candidate as {
    readonly completedRows: number;
    readonly totalRows: number;
  };
}

describe("flat cooperative candidate — identity carry", () => {
  test.each([
    ["filter-only", FILTER_ONLY_QUERY],
    ["sort-only", SORT_ONLY_QUERY],
    ["combined", COMBINED_QUERY],
  ])(
    "a delta-free flat set-query (%s) settles equal to a cold model",
    async (_label, nextQuery) => {
      const { model, scheduler } = createFixture();
      const transition = model.setQuery(nextQuery);
      // Non-vacuity: the change actually took the cooperative path — an
      // accidental synchronous fast path would make the oracle prove nothing
      // about this module.
      expect(scheduler.entries.length).toBeGreaterThan(0);
      scheduler.flushAll();
      await transition.finished;

      expectSettledEqualsCold(model, FIXTURE_ROWS, nextQuery);
      model.dispose();
    },
  );

  test.each([
    ["filter-only", FILTER_ONLY_QUERY],
    ["sort-only", SORT_ONLY_QUERY],
    ["combined", COMBINED_QUERY],
  ])(
    "a delta-free flat set-query (%s) carries rows and recordsBySlot by identity",
    async (_label, nextQuery) => {
      const { model, scheduler } = createFixture();
      const before = rootOf(model);
      const transition = model.setQuery(nextQuery);
      expect(scheduler.entries.length).toBeGreaterThan(0);
      scheduler.flushAll();
      await transition.finished;

      const after = rootOf(model);
      expect(after).not.toBe(before);
      expect(Object.is(after.rows, before.rows)).toBe(true);
      expect(Object.is(after.recordsBySlot, before.recordsBySlot)).toBe(true);
      // Survivor tree entries hold the CAPTURED records by identity — no
      // freeze-spread reconstruction anywhere on the carry path. Row "a"
      // (score 50) passes gte 40, lte 60 and every sort, so it survives all
      // three shapes.
      const survivor = after.visible.rows.get("a");
      expect(survivor).toBeDefined();
      expect(Object.is(survivor!.record, before.rows.get("a"))).toBe(true);
      model.dispose();
    },
  );

  test("a mid-flight transaction upgrades the candidate and the settled root reflects it", async () => {
    const { model, scheduler } = createFixture();
    const before = rootOf(model);
    const transition = model.setQuery(COMBINED_QUERY);
    expect(scheduler.entries.length).toBeGreaterThan(0);
    const candidate = activeCandidateOf(model);

    // Partial build: three one-unit slices, then a delta that touches all
    // three change classes — an update that flips a survivor across the new
    // filter (e: 60 -> 100 leaves lte 60), a removal, and an insert that
    // lands inside the new filter.
    scheduler.flushOne();
    scheduler.flushOne();
    scheduler.flushOne();
    expect(
      model.applyTransaction({
        update: [{ id: "e", changes: { score: 100 } }],
        remove: ["c"],
        add: [{ id: "i", team: "Z", score: 55, note: "g", rank: 0 }],
      }),
    ).toMatchObject({ updated: 1, removed: 1, added: 1 });
    scheduler.flushAll();
    await transition.finished;

    const finalRows: readonly Row[] = [
      { id: "a", team: "X", score: 50, note: "b", rank: 5 },
      { id: "b", team: "X", score: 30, note: "a", rank: 1 },
      { id: "d", team: "Y", score: 35, note: "c", rank: 2 },
      { id: "e", team: "X", score: 100, note: "d", rank: 3 },
      { id: "f", team: "Y", score: 45, note: "m", rank: 8 },
      { id: "g", team: "X", score: 10, note: "zz", rank: 4 },
      { id: "h", team: "Y", score: 70, note: "f", rank: 6 },
      { id: "i", team: "Z", score: 55, note: "g", rank: 0 },
    ];
    expectSettledEqualsCold(model, finalRows, COMBINED_QUERY);

    // The upgraded candidate rebuilt keyed/slot structures — the settled
    // root must NOT be identity-carried from the captured one.
    const after = rootOf(model);
    expect(Object.is(after.rows, before.rows)).toBe(false);
    expect(Object.is(after.recordsBySlot, before.recordsBySlot)).toBe(false);
    // Delta accounting still lands exactly: no trailing blip, no shortfall.
    expect(candidate.completedRows).toBe(candidate.totalRows);
    model.dispose();
  });

  test("a replayed insert past the captured bitset's word coverage keeps its membership bit", async () => {
    // The captured root's bitset spans ONE 32-bit word (capacity 8), so a
    // replayed insert landing past bit 31 exercises the `append`-time
    // widening: without `cloneMembership`, `setMembershipBit` beyond a
    // Uint32Array's length is a SILENT no-op and the grown-slot survivor's
    // bit simply drops.
    const { model, scheduler } = createFixture();
    expect(rootOf(model).slotCapacity).toBe(FIXTURE_ROWS.length);
    const transition = model.setQuery(COMBINED_QUERY);
    expect(scheduler.entries.length).toBeGreaterThan(0);

    scheduler.flushOne();
    scheduler.flushOne();
    const inserted: Row[] = Array.from({ length: 30 }, (_, index) => ({
      id: `j${index}`,
      team: "Z",
      score: 50, // passes lte 60 — every grown-slot row is VISIBLE.
      note: `n${index}`,
      rank: 100 + index,
    }));
    expect(model.applyTransaction({ add: inserted })).toMatchObject({
      added: 30,
    });
    // Non-vacuity: the delta target genuinely allocated a slot past bit 31,
    // so a fixture drift (fewer inserts, bigger seed capacity) cannot let
    // this test degrade into the one-word case silently.
    const target = rootOf(model);
    const insertedSlots = inserted.map((row) => target.rows.get(row.id)!.slot);
    expect(Math.max(...insertedSlots)).toBeGreaterThan(31);

    scheduler.flushAll();
    await transition.finished;
    expectSettledEqualsCold(
      model,
      [...FIXTURE_ROWS, ...inserted],
      COMBINED_QUERY,
    );
    model.dispose();
  });

  test("grouped-to-flat set-query does NOT identity-carry (evaluate lane)", async () => {
    const { model, scheduler } = createFixture({ query: GROUPED_QUERY });
    const transition = model.setQuery(COMBINED_QUERY);
    expect(scheduler.entries.length).toBeGreaterThan(0);
    scheduler.flushAll();
    await transition.finished;

    expectSettledEqualsCold(model, FIXTURE_ROWS, COMBINED_QUERY);
    // The captured records' metadata still holds the GROUPED groupPath; a
    // carried record would leak it. Fresh evaluation under the flat plan
    // makes every settled record's groupPath empty.
    const settled = rootOf(model);
    for (const [, record] of settled.rows.entries()) {
      expect(record.metadata.groupPath).toEqual([]);
    }
    model.dispose();
  });

  test("a settled delta-free flat transition accounts for every row (completed === total)", async () => {
    const { model, scheduler } = createFixture();
    const transition = model.setQuery(COMBINED_QUERY);
    const candidate = activeCandidateOf(model);
    expect(candidate.totalRows).toBe(FIXTURE_ROWS.length);
    scheduler.flushAll();
    await transition.finished;

    expect(candidate.completedRows).toBe(candidate.totalRows);
    model.dispose();
  });
});
