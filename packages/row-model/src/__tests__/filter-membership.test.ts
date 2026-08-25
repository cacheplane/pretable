import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  type PretableQueryFor,
} from "../index";
import { filterVerdict, type CompiledQuery } from "../compiled-query";
import {
  rowPassesFilter,
  rowPassesFilterInGroupIndex,
} from "../filter-membership";
import { getGroupIndex } from "../group-index";
import type { RevisionRoot } from "../internal-types";
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
}

const helper = createColumnHelper<Holding>();

function createColumns() {
  return [
    helper.accessor("team", (row: Holding) => row.team, { type: "text" }),
    helper.accessor("score", (row: Holding) => row.score, {
      type: "number",
      aggregate: "sum",
    }),
  ] as const;
}

type FixtureColumns = ReturnType<typeof createColumns>;

/**
 * Both populations are non-trivial in BOTH group branches: Alpha and Beta
 * each hold a passing and a failing row, so a helper that answered from the
 * group's existence, or from "any row in the root", would be caught.
 */
const ROWS: readonly Holding[] = Object.freeze([
  { id: "r1", team: "Alpha", score: 90 },
  { id: "r2", team: "Alpha", score: 10 },
  { id: "r3", team: "Beta", score: 70 },
  { id: "r4", team: "Beta", score: 20 },
]);

const PASSING = ["r1", "r3"] as const;
const FAILING = ["r2", "r4"] as const;

function query(grouped: boolean): PretableQueryFor<FixtureColumns> {
  return {
    filters: [{ columnId: "score", operator: "gte", value: 50 }],
    sort: [{ columnId: "score", direction: "asc" }],
    rowGroups: grouped ? [{ columnId: "team", direction: "asc" }] : [],
  } as PretableQueryFor<FixtureColumns>;
}

function createRoot<TColumns>(
  queryPlan: CompiledQuery<TColumns>,
  rows: readonly Holding[] = ROWS,
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

describe("rowPassesFilter", () => {
  test("a FLAT root answers from the visible tree", () => {
    const plan = compileQuery({
      derivations: createColumns(),
      query: query(false),
    });
    const root = createRoot(plan);
    // Control: this root's verdicts are genuinely mixed.
    expect(root.visible.rows.size).toBe(PASSING.length);

    for (const id of PASSING) expect(rowPassesFilter(root, id)).toBe(true);
    for (const id of FAILING) expect(rowPassesFilter(root, id)).toBe(false);
  });

  test("a GROUPED root answers from group-index leaf membership", () => {
    const plan = compileQuery({
      derivations: createColumns(),
      query: query(true),
    });
    const root = createRoot(plan);
    // Control: the grouped root's flat tree is empty, so a helper that only
    // consulted `visible.rows` would answer false for EVERY row here.
    expect(root.visible.rows.size).toBe(0);
    expect(getGroupIndex(root.visible)).toBeDefined();

    for (const id of PASSING) expect(rowPassesFilter(root, id)).toBe(true);
    for (const id of FAILING) expect(rowPassesFilter(root, id)).toBe(false);
  });

  test("both shapes agree with the plan's own verdict for every row", () => {
    for (const grouped of [false, true]) {
      const plan = compileQuery({
        derivations: createColumns(),
        query: query(grouped),
      });
      const root = createRoot(plan);
      for (const [sourceOrder, row] of ROWS.entries()) {
        expect(rowPassesFilter(root, row.id)).toBe(
          filterVerdict(plan, {
            rowId: row.id,
            row,
            sourceOrder,
            slot: sourceOrder,
          }),
        );
      }
    }
  });

  test("an unknown row is not a member, in either shape", () => {
    for (const grouped of [false, true]) {
      const plan = compileQuery({
        derivations: createColumns(),
        query: query(grouped),
      });
      expect(rowPassesFilter(createRoot(plan), "never-seen")).toBe(false);
    }
  });

  test("the grouped accessor answers directly from a group index", () => {
    const plan = compileQuery({
      derivations: createColumns(),
      query: query(true),
    });
    const grouped = getGroupIndex(createRoot(plan).visible)!;

    for (const id of PASSING)
      expect(rowPassesFilterInGroupIndex(grouped, id)).toBe(true);
    for (const id of FAILING) {
      // Present in the index (it has a parent) but not in the leaf tree.
      expect(grouped.rowParents.get(id)).toBeDefined();
      expect(rowPassesFilterInGroupIndex(grouped, id)).toBe(false);
    }
  });

  test("with no filters every row is a member, in either shape", () => {
    for (const grouped of [false, true]) {
      const plan = compileQuery({
        derivations: createColumns(),
        query: {
          filters: [],
          sort: [{ columnId: "score", direction: "asc" }],
          rowGroups: grouped ? [{ columnId: "team", direction: "asc" }] : [],
        } as PretableQueryFor<FixtureColumns>,
      });
      const root = createRoot(plan);
      for (const row of ROWS) expect(rowPassesFilter(root, row.id)).toBe(true);
    }
  });
});
