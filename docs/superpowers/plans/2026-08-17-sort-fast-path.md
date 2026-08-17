# Sort Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sort-only `setQuery` on an ungrouped model complete synchronously by carrying prior evaluation results forward and bulk-building the indexes, closing #457's 515ms-at-50k gap to TanStack parity.

**Architecture:** A query-delta classifier in `compiled-query.ts` (static methods on `CompiledQueryPlan`, so private facets are comparable) decides when a `setQuery` changed nothing but the applied sort. When it fires and the query is ungrouped, `create-local-row-model.ts` skips the cooperative transition entirely: a new module `sort-rebuild.ts` rebuilds each record's metadata around carried values (`resortRecordMetadata`), `Array.sort`s the filter-passing records, and bulk-builds the visible tree in O(n) via a new sorted-input constructor in `order-statistic-tree.ts`. Everything else keeps the cooperative path.

**Tech Stack:** TypeScript, vitest (`pnpm --filter @pretable-internal/row-model test`), pnpm workspace, Playwright bench (`apps/bench`).

**Spec:** `docs/superpowers/specs/2026-08-17-sort-fast-path-design.md` — read it first.

**Conventions that bind every task:**
- `packages/*` code is vanilla — no new dependencies.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit.
- Comments state constraints the code can't show — never narrate the change.
- Run tests from the package dir or with `--filter @pretable-internal/row-model`; the suite currently passes 327+ tests.

---

### Task 1: Query-delta classifier

**Files:**
- Modify: `packages/row-model/src/compiled-query.ts`
- Test: `packages/row-model/src/__tests__/query-delta.test.ts` (create)

The classifier compares two compiled plans facet-by-facet. It lives on `CompiledQueryPlan` as static methods because facet state (`#runtimeQuery`, `#runtimeColumns`, `#filterAuthority`, `#sortAuthority`) is private, and statics can read privates of instances. Exported free functions wrap the statics. Nothing is added to the package's public index — `create-local-row-model.ts` imports from `"./compiled-query"` directly.

**Conservatism invariant (the thing the tests pin):** any input the classifier cannot positively identify — either plan not created by `compileQuery`, any facet not provably equal — classifies as *changed*. A wrong `false` from `isSortOnlyChange` costs a slow transition; a wrong `true` corrupts results.

- [ ] **Step 1: Write the failing tests**

Create `packages/row-model/src/__tests__/query-delta.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createColumnHelper } from "../index";
import {
  compileQuery,
  isSortOnlyChange,
  type CompiledQuery,
} from "../compiled-query";

interface Row {
  id: number;
  team: string;
  score: number;
  note: string;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
  helper.accessor("note", { type: "text" }),
] as const;

type Cols = typeof columns;

const plan = (
  query: Parameters<typeof compileQuery<Cols>>[0]["query"],
  overrides?: Partial<Parameters<typeof compileQuery<Cols>>[0]>,
): CompiledQuery<Cols> =>
  compileQuery<Cols>({
    derivations: columns,
    query,
    operation: "set-query",
    ...overrides,
  });

const baseQuery = {
  filters: [{ columnId: "team", operator: "equals", value: "a" }],
  sort: [{ columnId: "score", direction: "desc" }],
  rowGroups: [],
} as const;

describe("isSortOnlyChange", () => {
  test("true when only the sort differs", () => {
    const previous = plan(baseQuery);
    const next = plan({ ...baseQuery, sort: [{ columnId: "team" }] });
    expect(isSortOnlyChange(previous, next)).toBe(true);
  });

  test("true for direction flip, added column, removal to unsorted", () => {
    const previous = plan(baseQuery);
    for (const sort of [
      [{ columnId: "score", direction: "asc" }],
      [
        { columnId: "score", direction: "desc" },
        { columnId: "note", direction: "asc" },
      ],
      [],
    ] as const) {
      expect(isSortOnlyChange(previous, plan({ ...baseQuery, sort }))).toBe(
        true,
      );
    }
  });

  test("false when the sort is identical (nothing changed)", () => {
    const previous = plan(baseQuery);
    // compileQuery dedupes identical plans; build without `previous` so we
    // get a distinct object with equal facets.
    const next = plan(baseQuery);
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when filters also changed", () => {
    const previous = plan(baseQuery);
    const next = plan({
      ...baseQuery,
      filters: [{ columnId: "team", operator: "equals", value: "b" }],
      sort: [{ columnId: "team" }],
    });
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when rowGroups also changed", () => {
    const previous = plan(baseQuery);
    const next = plan({
      ...baseQuery,
      rowGroups: [{ columnId: "team" }],
      sort: [{ columnId: "team" }],
    });
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when derivations changed for an active column", () => {
    const replaced = [
      helper.accessor("team", { type: "text" }),
      { ...columns[1], accessor: (row: Row) => row.score * 2 },
      helper.accessor("note", { type: "text" }),
    ] as const;
    const previous = plan(baseQuery);
    const next = compileQuery({
      derivations: replaced as never,
      query: { ...baseQuery, sort: [{ columnId: "team" }] } as never,
      operation: "set-query",
    });
    expect(isSortOnlyChange(previous, next as never)).toBe(false);
  });

  test("false when filter authority differs", () => {
    const previous = plan(baseQuery);
    const next = plan(
      { ...baseQuery, sort: [{ columnId: "team" }] },
      { filterAuthority: "external" },
    );
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false when sort authority differs", () => {
    const previous = plan(baseQuery);
    const next = plan(
      { ...baseQuery, sort: [{ columnId: "team" }] },
      { sortAuthority: "external" },
    );
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false under external sort authority in both plans (runtime sort is empty twice)", () => {
    const previous = plan(baseQuery, { sortAuthority: "external" });
    const next = plan(
      { ...baseQuery, sort: [{ columnId: "team" }] },
      { sortAuthority: "external" },
    );
    expect(isSortOnlyChange(previous, next)).toBe(false);
  });

  test("false for foreign plan objects", () => {
    const previous = plan(baseQuery);
    const fake = {
      query: previous.query,
      derivations: previous.derivations,
    } as unknown as CompiledQuery<Cols>;
    expect(isSortOnlyChange(fake, previous)).toBe(false);
    expect(isSortOnlyChange(previous, fake)).toBe(false);
  });
});
```

Note: check `createColumnHelper` / filter operator names against an existing test (e.g. `transitions.test.ts`) and adjust the fixture syntax to match real usage before running — the shapes above are illustrative of intent, the assertions are the contract.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/row-model test -- query-delta`
Expected: FAIL — `isSortOnlyChange` is not exported.

- [ ] **Step 3: Implement the classifier**

In `packages/row-model/src/compiled-query.ts`:

1. Hoist `orderingEqual` out of `queryEqual` (line ~844) to module scope unchanged; have `queryEqual` call it.
2. Add to `CompiledQueryPlan`:

```ts
/**
 * Facet delta between two plans this module compiled. `undefined` when either
 * plan is foreign — the caller must treat that as "everything changed".
 * Compares RUNTIME facets: under external sort authority the runtime sort is
 * `[]`, so a public sort change classifies as no applied change.
 */
static classifyDelta(
  previous: unknown,
  next: unknown,
):
  | {
      readonly derivationsChanged: boolean;
      readonly filtersChanged: boolean;
      readonly groupsChanged: boolean;
      readonly sortChanged: boolean;
      readonly authorityChanged: boolean;
    }
  | undefined {
  if (
    !(previous instanceof CompiledQueryPlan) ||
    !(next instanceof CompiledQueryPlan)
  ) {
    return undefined;
  }
  return Object.freeze({
    derivationsChanged: !(
      derivationsEqualForPlan(
        previous.#runtimeColumns,
        next.#runtimeColumns,
        previous.#runtimeQuery,
      ) &&
      derivationsEqualForPlan(
        previous.#runtimeColumns,
        next.#runtimeColumns,
        next.#runtimeQuery,
      )
    ),
    filtersChanged: !filtersEqual(
      previous.#runtimeQuery.filters,
      next.#runtimeQuery.filters,
    ),
    groupsChanged: !orderingEqual(
      previous.#runtimeQuery.rowGroups,
      next.#runtimeQuery.rowGroups,
    ),
    sortChanged: !orderingEqual(
      previous.#runtimeQuery.sort,
      next.#runtimeQuery.sort,
    ),
    authorityChanged:
      previous.#filterAuthority !== next.#filterAuthority ||
      previous.#sortAuthority !== next.#sortAuthority,
  });
}
```

3. Export free functions after the class:

```ts
export type CompiledQueryDelta = NonNullable<
  ReturnType<typeof CompiledQueryPlan.classifyDelta>
>;

export function classifyQueryDelta<TColumns>(
  previous: CompiledQuery<TColumns>,
  next: CompiledQuery<TColumns>,
): CompiledQueryDelta | undefined {
  return CompiledQueryPlan.classifyDelta(previous, next);
}

/** True only when the applied sort is the sole difference between the plans. */
export function isSortOnlyChange<TColumns>(
  previous: CompiledQuery<TColumns>,
  next: CompiledQuery<TColumns>,
): boolean {
  const delta = CompiledQueryPlan.classifyDelta(previous, next);
  return (
    delta !== undefined &&
    delta.sortChanged &&
    !delta.derivationsChanged &&
    !delta.filtersChanged &&
    !delta.groupsChanged &&
    !delta.authorityChanged
  );
}
```

Do NOT add these to `packages/row-model/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/row-model test -- query-delta`
Expected: PASS, all cases.

- [ ] **Step 5: Run the full package suite (no regressions)**

Run: `pnpm --filter @pretable-internal/row-model test`
Expected: PASS (327+ tests).

- [ ] **Step 6: Commit**

```bash
git add packages/row-model/src/compiled-query.ts packages/row-model/src/__tests__/query-delta.test.ts
git commit -m "feat(row-model): classify query deltas between compiled plans"
```

---

### Task 2: O(n) sorted-input tree constructor

**Files:**
- Modify: `packages/row-model/src/persistent/order-statistic-tree.ts`
- Test: `packages/row-model/src/__tests__/order-statistic-tree.test.ts` (add to the existing tree test file; if tree tests live elsewhere, follow that location)

A balanced tree built bottom-up from an already-sorted array, mirroring the existing internal `createDeferredMeasureTransientOrderStatisticTree` pattern (`order-statistic-tree.ts:918`): exported from the module, deliberately omitted from the package index.

**Correctness constraint:** the tree's total order is `context.compare` then `compareIds` on tie (`compareEntries`, line ~186). Input must be strictly increasing under that composite order — verified in an O(n) pass that throws on violation (this also rejects duplicate ids). A tree built from misordered input would corrupt every later `rankOf`/`insertOrReplace`, so the check is unconditional, not dev-only.

- [ ] **Step 1: Write the failing tests**

Add to the tree test file:

```ts
import {
  compareOrderStatisticTreeIds,
  createOrderStatisticTree,
  createOrderStatisticTreeFromSortedEntries,
} from "../persistent/order-statistic-tree";

interface Entry {
  readonly id: number;
  readonly rank: number;
}

const context = {
  getId: (entry: Entry) => entry.id,
  compare: (left: Entry, right: Entry) => left.rank - right.rank,
  measure: {
    empty: 0,
    fromEntry: () => 1,
    combine: (left: number, right: number) => left + right,
  },
};

describe("createOrderStatisticTreeFromSortedEntries", () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({
    id: index,
    rank: index * 2,
  }));

  test("matches incremental construction observably", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    const bulk = createOrderStatisticTreeFromSortedEntries(like, entries);
    let incremental = like;
    for (const entry of entries) incremental = incremental.insertOrReplace(entry);
    expect(bulk.size).toBe(incremental.size);
    for (let index = 0; index < entries.length; index += 25) {
      expect(bulk.entryAt(index)).toEqual(incremental.entryAt(index));
      expect(bulk.rankOf(entries[index]!.id)).toBe(
        incremental.rankOf(entries[index]!.id),
      );
    }
  });

  test("produces a balanced tree", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    const bulk = createOrderStatisticTreeFromSortedEntries(like, entries);
    // Use the module's diagnostics accessor for balance; adjust the call to
    // however OrderStatisticTreeDiagnostics is obtained in existing tests.
    expect(diagnosticsOf(bulk).balanced).toBe(true);
    expect(diagnosticsOf(bulk).count).toBe(entries.length);
  });

  test("supports later incremental mutation", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    let tree = createOrderStatisticTreeFromSortedEntries(like, entries);
    tree = tree.insertOrReplace({ id: 5000, rank: 3 });
    expect(tree.size).toBe(entries.length + 1);
    expect(tree.rankOf(5000)).toBe(2);
    tree = tree.remove(0);
    expect(tree.rankOf(5000)).toBe(1);
  });

  test("throws on misordered input", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(like, [
        { id: 1, rank: 10 },
        { id: 2, rank: 5 },
      ]),
    ).toThrow(TypeError);
  });

  test("throws on equal-rank entries whose ids are misordered", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    const misordered = [
      { id: 2, rank: 7 },
      { id: 1, rank: 7 },
    ];
    expect(
      compareOrderStatisticTreeIds(2, 1),
    ).toBeGreaterThan(0); // control: proves the fixture is actually misordered
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(like, misordered),
    ).toThrow(TypeError);
  });

  test("throws on duplicate ids", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(like, [
        { id: 1, rank: 1 },
        { id: 1, rank: 2 },
      ]),
    ).toThrow(TypeError);
  });

  test("empty input yields an empty tree", () => {
    const like = createOrderStatisticTree<number, Entry, number>(context);
    const bulk = createOrderStatisticTreeFromSortedEntries(like, []);
    expect(bulk.size).toBe(0);
  });

  test("throws for a foreign tree object", () => {
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(
        { size: 0 } as never,
        [],
      ),
    ).toThrow(TypeError);
  });
});
```

Duplicate-id check note: duplicates compare equal on rank and equal on id, so `compareEntries` returns 0, which the strict `< 0` requirement rejects — the duplicate test passes through the same throw path by design.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/row-model test -- order-statistic`
Expected: FAIL — `createOrderStatisticTreeFromSortedEntries` is not exported.

- [ ] **Step 3: Implement**

In `order-statistic-tree.ts`, inside the module (it needs `TreeNode`, `createNode`, `compareEntries`, `nodeHeight`, and the `PersistentOrderStatisticTree` constructor):

```ts
/** Internal bulk-build primitive; deliberately omitted from the package index. */
export function compareOrderStatisticTreeIds(
  left: OrderStatisticTreeId,
  right: OrderStatisticTreeId,
): number {
  return compareIds(left, right);
}

/**
 * Internal bulk-build primitive; deliberately omitted from the package index.
 * Builds a balanced persistent tree in O(n) from entries already sorted by
 * the tree's total order (compare, then id on ties). The order is verified
 * unconditionally: a misordered build would silently corrupt every later
 * rank and lookup, which is strictly worse than the O(n) check.
 */
export function createOrderStatisticTreeFromSortedEntries<
  TId extends OrderStatisticTreeId,
  TEntry,
  TMeasure,
>(
  like: OrderStatisticTree<TId, TEntry, TMeasure>,
  sorted: readonly TEntry[],
): OrderStatisticTree<TId, TEntry, TMeasure> {
  if (!(like instanceof PersistentOrderStatisticTree)) {
    throw new TypeError("Bulk builds require a tree created by this module.");
  }
  return like[buildFromSortedEntries](sorted);
}
```

Add a module-scoped symbol next to `createDeferredMeasureDraft` and a method on `PersistentOrderStatisticTree` (mirror how `createDeferredMeasureDraft` is declared and access the instance's context the same way that method does):

```ts
[buildFromSortedEntries](
  sorted: readonly TEntry[],
): PersistentOrderStatisticTree<TId, TEntry, TMeasure> {
  const context = this.#context; // match the field name used by the class
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (
      compareEntries(
        previous,
        context.getId(previous),
        current,
        context.getId(current),
        context,
      ) >= 0
    ) {
      throw new TypeError(
        "Bulk build input must be strictly sorted by the tree's total order.",
      );
    }
  }
  const byId = createPersistentMap<TId, TEntry>().asTransient();
  for (const entry of sorted) byId.set(context.getId(entry), entry);
  const build = (
    low: number,
    high: number,
  ): TreeNode<TId, TEntry, TMeasure> | null => {
    if (low >= high) return null;
    const middle = (low + high) >> 1;
    const entry = sorted[middle]!;
    const node = createNode(entry, context.getId(entry), context, null);
    node.left = build(low, middle);
    node.right = build(middle + 1, high);
    node.count = 1 + (node.left?.count ?? 0) + (node.right?.count ?? 0);
    node.height = 1 + Math.max(nodeHeight(node.left), nodeHeight(node.right));
    // Recompute the subtree measure the same way the incremental path does —
    // reuse the existing measure-recompute helper rather than reimplementing
    // the combine order (left, own, right).
    recomputeNodeMeasure(node, context);
    return node;
  };
  return new PersistentOrderStatisticTree(
    build(0, sorted.length),
    byId.freeze(),
    context,
  );
}
```

Before writing this, read how the incremental path recomputes `node.measure` (search for where `measure` is assigned after rotations) and call that exact helper; if it is inlined, extract it to a shared function rather than duplicating the combine order. Also confirm the constructor's parameter order by reading it — do not guess.

Midpoint bias note: `(low + high) >> 1` yields height ⌈log2(n+1)⌉, within the AVL balance bound for every n; the balance test in Step 1 is the proof.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/row-model test -- order-statistic`
Expected: PASS.

- [ ] **Step 5: Full package suite**

Run: `pnpm --filter @pretable-internal/row-model test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/row-model/src/persistent/order-statistic-tree.ts packages/row-model/src/__tests__/
git commit -m "feat(row-model): O(n) balanced tree construction from sorted entries"
```

---

### Task 3: Metadata carryover (`resortRecordMetadata`)

**Files:**
- Modify: `packages/row-model/src/compiled-query.ts`
- Test: `packages/row-model/src/__tests__/sort-fast-path.test.ts` (create)

Rebuilds one row's `CompiledRowMetadata` under a new plan without re-running accessors whose values the old metadata already retains. Old metadata retains values in three places: `sortKeys` (old sort columns), `groupPath` (group columns — empty when ungrouped), and `aggregateLeaves[].allLeaf.value` (aggregate columns). Filter columns retain only the boolean verdict — a column that was filter-only in the old plan and is newly sorted must run its accessor.

**Precondition (documented, enforced by the caller):** only valid when `isSortOnlyChange(previousPlan, nextPlan)` — that guarantees accessor identity for every next-active column, filter set equality (so `filterPasses` carries), and group set equality (so `groupPath` carries).

- [ ] **Step 1: Write the failing tests**

Create `packages/row-model/src/__tests__/sort-fast-path.test.ts` (this file grows across Tasks 3–5):

```ts
import { describe, expect, test, vi } from "vitest";

import { createColumnHelper } from "../index";
import {
  compileQuery,
  resortRecordMetadata,
  type CompiledQuery,
} from "../compiled-query";
import { PretableRowModelError } from "../errors";

interface Row {
  id: number;
  team: string;
  score: number;
  note: string;
}

describe("resortRecordMetadata", () => {
  const makeColumns = (spies: { note?: (row: Row) => string }) => {
    const helper = createColumnHelper<Row>();
    return [
      helper.accessor("team", { type: "text" }),
      helper.accessor("score", { type: "number", aggregate: "sum" }),
      helper.accessor((row) => (spies.note ?? ((r: Row) => r.note))(row), {
        id: "note",
        type: "text",
      }),
    ] as const;
  };

  const row: Row = { id: 1, team: "a", score: 10, note: "n" };

  test("carries sort, filter, and aggregate values without re-running accessors", () => {
    const noteSpy = vi.fn((r: Row) => r.note);
    const columns = makeColumns({ note: noteSpy });
    const previousPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [{ columnId: "team", operator: "equals", value: "a" }],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [],
      },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    const nextPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [{ columnId: "team", operator: "equals", value: "a" }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [],
      },
      previous: previousPlan,
      operation: "set-query",
    });
    const rebuilt = resortRecordMetadata(nextPlan, previous);
    expect(rebuilt.filterPasses).toBe(previous.filterPasses);
    expect(rebuilt.groupPath).toBe(previous.groupPath);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "score", value: 10 }]);
    expect(rebuilt.aggregateLeaves[0]!.allLeaf.value).toBe(10);
    // The sort column's value came from previous.sortKeys; the aggregate value
    // from previous.aggregateLeaves. The un-referenced `note` accessor never ran.
    expect(noteSpy).not.toHaveBeenCalled();
  });

  test("runs the accessor for a newly-active sort column only", () => {
    const noteSpy = vi.fn((r: Row) => r.note);
    const columns = makeColumns({ note: noteSpy });
    const previousPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [],
      },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    expect(noteSpy).not.toHaveBeenCalled();
    const nextPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [],
        sort: [{ columnId: "note", direction: "asc" }],
        rowGroups: [],
      },
      previous: previousPlan,
      operation: "set-query",
    });
    const rebuilt = resortRecordMetadata(nextPlan, previous);
    expect(rebuilt.sortKeys).toEqual([{ columnId: "note", value: "n" }]);
    expect(noteSpy).toHaveBeenCalledTimes(1);
  });

  test("aggregate leaves embed the NEW dependency", () => {
    const columns = makeColumns({});
    const previousPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [],
      },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 3 });
    const nextPlan = compileQuery({
      derivations: columns,
      query: {
        filters: [],
        sort: [{ columnId: "team", direction: "asc" }],
        rowGroups: [],
      },
      previous: previousPlan,
      operation: "set-query",
    });
    const rebuilt = resortRecordMetadata(nextPlan, previous);
    expect(rebuilt.aggregateLeaves[0]!.allLeaf.dependency.sortKeys).toBe(
      rebuilt.sortKeys,
    );
    expect(rebuilt.aggregateLeaves[0]!.allLeaf.dependency.sourceOrder).toBe(3);
    expect(rebuilt.aggregateLeaves[0]!.filteredLeaf).toBe(
      rebuilt.aggregateLeaves[0]!.allLeaf,
    );
  });

  test("second call for the same row returns the cached metadata", () => {
    const columns = makeColumns({});
    const previousPlan = compileQuery({
      derivations: columns,
      query: { filters: [], sort: [{ columnId: "score" }], rowGroups: [] },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    const nextPlan = compileQuery({
      derivations: columns,
      query: { filters: [], sort: [{ columnId: "team" }], rowGroups: [] },
      previous: previousPlan,
      operation: "set-query",
    });
    const first = resortRecordMetadata(nextPlan, previous);
    expect(resortRecordMetadata(nextPlan, previous)).toBe(first);
    // And evaluate() on the same plan sees the seeded cache:
    expect(nextPlan.evaluate({ rowId: 1, row, sourceOrder: 0 })).toBe(first);
  });

  test("accessor failure surfaces the slow path's error shape", () => {
    const columns = makeColumns({
      note: () => {
        throw new Error("boom");
      },
    });
    const previousPlan = compileQuery({
      derivations: columns,
      query: { filters: [], sort: [{ columnId: "score" }], rowGroups: [] },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    const nextPlan = compileQuery({
      derivations: columns,
      query: { filters: [], sort: [{ columnId: "note" }], rowGroups: [] },
      previous: previousPlan,
      operation: "set-query",
    });
    try {
      resortRecordMetadata(nextPlan, previous);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PretableRowModelError);
      expect((error as PretableRowModelError).code).toBe("accessor-failed");
      expect((error as PretableRowModelError).details).toMatchObject({
        rowId: 1,
        columnId: "note",
      });
    }
  });

  test("throws for a foreign plan", () => {
    const columns = makeColumns({});
    const previousPlan = compileQuery({
      derivations: columns,
      query: { filters: [], sort: [{ columnId: "score" }], rowGroups: [] },
      operation: "set-query",
    });
    const previous = previousPlan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    expect(() =>
      resortRecordMetadata({} as CompiledQuery<never>, previous as never),
    ).toThrow(TypeError);
  });
});
```

Before running, verify against the real API: the exact `PretableRowModelError` detail field names (read `errors.ts`), the exact `evaluate` input/metadata types, and whether `helper.accessor` supports the function-accessor form used for `note` (read `column-types.ts` or an existing test; if the helper differs, express the spy through whatever form the helper supports — the point is an accessor whose invocation count we can observe).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: FAIL — `resortRecordMetadata` is not exported.

- [ ] **Step 3: Implement**

In `compiled-query.ts`, add a static on `CompiledQueryPlan` plus a free-function export. Reuse the exact metadata construction from `evaluate` (lines ~1422–1464) — same freeze pattern, same cache entry shape:

```ts
static resortMetadata(
  plan: unknown,
  previous: CompiledRowMetadata<never, PretableRowId, unknown>,
): CompiledRowMetadata<never, PretableRowId, unknown> {
  if (!(plan instanceof CompiledQueryPlan)) {
    throw new TypeError("Metadata carryover requires a compiled query plan.");
  }
  const cached = plan.#evaluationCache.get(previous.row as object);
  if (
    cached &&
    Object.is(cached.rowId, previous.rowId) &&
    cached.sourceOrder === previous.sourceOrder
  ) {
    return cached.metadata as never;
  }
  const carried = (columnId: string): { found: boolean; value: unknown } => {
    for (const key of previous.sortKeys) {
      if (key.columnId === columnId) return { found: true, value: key.value };
    }
    for (const key of previous.groupPath) {
      if (key.columnId === columnId) return { found: true, value: key.value };
    }
    for (const leaf of previous.aggregateLeaves) {
      if (leaf.columnId === columnId) {
        return { found: true, value: leaf.allLeaf.value };
      }
    }
    return { found: false, value: undefined };
  };
  const valueOf = (columnId: string): unknown => {
    const prior = carried(columnId);
    if (prior.found) return prior.value;
    const column = plan.#byId.get(columnId)!;
    try {
      return column.accessor(previous.row as never);
    } catch (cause) {
      throw new PretableRowModelError(
        "accessor-failed",
        `Column ${columnId} accessor failed.`,
        {
          operation: plan.#operation,
          rowId: previous.rowId,
          columnId,
          cause,
        },
      );
    }
  };
  const sortKeys = Object.freeze(
    plan.#runtimeQuery.sort.map((entry) =>
      Object.freeze({
        columnId: entry.columnId,
        value: valueOf(entry.columnId),
      }),
    ),
  );
  const dependency = Object.freeze({
    sourceOrder: previous.sourceOrder,
    sortKeys,
  });
  const aggregateLeaves = Object.freeze(
    plan.#aggregateColumns.map((column, index) => {
      const prior = previous.aggregateLeaves[index];
      const value =
        prior !== undefined && prior.columnId === column.id
          ? prior.allLeaf.value
          : valueOf(column.id);
      const allLeaf = Object.freeze({
        id: previous.rowId,
        row: previous.row,
        value,
        dependency,
      });
      return Object.freeze({
        columnId: column.id,
        aggregate: column.aggregate,
        allLeaf,
        filteredLeaf: previous.filterPasses ? allLeaf : undefined,
      });
    }),
  );
  const metadata = Object.freeze({
    rowId: previous.rowId,
    row: previous.row,
    sourceOrder: previous.sourceOrder,
    filterPasses: previous.filterPasses,
    groupPath: previous.groupPath,
    sortKeys,
    aggregateLeaves,
  });
  plan.#evaluationCache.set(previous.row as object, {
    rowId: previous.rowId,
    sourceOrder: previous.sourceOrder,
    metadata: metadata as never,
  });
  return metadata as never;
}
```

Free function (typed against the real generics — mirror `evaluate`'s signature style):

```ts
/**
 * Rebuilds one row's metadata under `nextPlan` from a prior evaluation,
 * re-running accessors only for columns whose values the prior metadata does
 * not retain. Valid ONLY when `isSortOnlyChange(previousPlan, nextPlan)` —
 * the caller owns that check; this function trusts filter verdicts and group
 * paths it is handed.
 */
export function resortRecordMetadata<TColumns, TRowId extends PretableRowId>(
  nextPlan: CompiledQuery<TColumns>,
  previous: CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>,
): CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns> {
  return CompiledQueryPlan.resortMetadata(
    nextPlan,
    previous as never,
  ) as never;
}
```

Adjust the `never` casts to whatever the file's existing internal casting idiom is (`as unknown as` chains appear throughout) — match it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/row-model/src/compiled-query.ts packages/row-model/src/__tests__/sort-fast-path.test.ts
git commit -m "feat(row-model): rebuild row metadata by carryover for sort-only plan changes"
```

---

### Task 4: Synchronous root rebuild (`sort-rebuild.ts`)

**Files:**
- Create: `packages/row-model/src/sort-rebuild.ts`
- Modify: `packages/row-model/src/diagnostics.ts`
- Test: `packages/row-model/src/__tests__/sort-fast-path.test.ts` (extend)

Composes Tasks 1–3 into a whole-root rebuild. Also adds the instrumentation counters (`synchronousRebuilds`, `synchronousRebuildMs`) — they land here because this module is what reports them.

- [ ] **Step 1: Add the instrumentation fields**

In `diagnostics.ts`, add to the work interface (near `transitionRows`, line ~24):

```ts
/** Sort-only rebuilds taken synchronously, bypassing the cooperative path. */
readonly synchronousRebuilds: number;
/** Total wall time inside synchronous sort-only rebuilds. */
readonly synchronousRebuildMs: number;
```

Initialize both to `0` in `createInstrumentation` (line ~84) and add them to any reset/snapshot key list the file maintains (there is a key array near line 61 — read it and follow its rule; `schedulerSliceDurations` is listed there, so scalar fields may or may not need registration — mirror how `transitionRows` is handled).

- [ ] **Step 2: Write the failing tests**

Extend `sort-fast-path.test.ts`:

```ts
import { rebuildRootForSortOnlyChange } from "../sort-rebuild";
import { createInstrumentation } from "../diagnostics"; // match real export name

describe("rebuildRootForSortOnlyChange", () => {
  // Build a real root via createLocalRowModel (flat query, some filtered-out
  // rows, an aggregate column), read it with the existing internal accessor
  // used by transitions.test.ts (getLocalRowModelRevisionCauseForTesting's
  // sibling — find how tests obtain the root; if none exists for the root
  // itself, drive the comparison entirely through the public snapshot of a
  // model wired in Task 5 and keep this describe focused on the pure
  // function via a hand-built root).
  //
  // Pure-function assertions, given captured root + sort-only nextPlan:

  test("the rebuilt root's visible order equals a cold build under nextPlan", () => {
    // Oracle: createFlatVisibleIndex(records.map(re-evaluated under a FRESH
    // equivalent plan), freshPlan.compareRows) — the existing pure builder in
    // visible-index.ts. Compare rowId sequences at every rank.
  });

  test("filtered-out rows stay out of visible but keep updated records in rows", () => {});

  test("revision and parentRevision are the requested values; cause kind is set-query", () => {});

  test("sourceOrder and expansion are carried by reference from the captured root", () => {});

  test("publicRow and integrity are carried by reference per record", () => {});

  test("instrumentation counts one rebuild and nonzero duration", () => {
    // pass createInstrumentation() and a controllable now(): first call 0,
    // second call 7 -> synchronousRebuildMs === 7, synchronousRebuilds === 1.
  });
});
```

Write these as real tests, not stubs — the comments above define each test's contract; the fixture is shared. Fixture requirements (memory: choose data that can disprove): at least 6 rows; the old sort order, the new sort order, and source order must be three pairwise-distinct permutations (assert this inside the test); at least one row filtered out; a tie on the new sort key so the rowId tiebreak is exercised.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: FAIL — module `../sort-rebuild` does not exist.

- [ ] **Step 4: Implement `sort-rebuild.ts`**

```ts
import {
  isSortOnlyChange,
  resortRecordMetadata,
  type CompiledQuery,
} from "./compiled-query";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import type { RevisionRoot, RowRecord } from "./internal-types";
import type { PretableRowId } from "./column-types";
import {
  compareOrderStatisticTreeIds,
  createOrderStatisticTreeFromSortedEntries,
  instrumentOrderStatisticTree,
} from "./persistent/order-statistic-tree";
import { createFlatVisibleTree } from "./visible-index";

/**
 * Synchronous whole-root rebuild for a sort-only plan change on an ungrouped
 * query. Runs to completion on the caller's stack — the deliberate trade
 * measured in #457: scheduler hops cost frames in the browser, and the
 * carryover makes the total work small enough to spend inline.
 */
export function rebuildRootForSortOnlyChange<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(options: {
  readonly captured: RevisionRoot<TRow, TRowId, TColumns>;
  readonly nextPlan: CompiledQuery<TColumns>;
  readonly revision: number;
  readonly now: () => number;
  readonly instrumentation?: LocalRowModelInstrumentation;
}): RevisionRoot<TRow, TRowId, TColumns> {
  const { captured, nextPlan, revision, now, instrumentation } = options;
  if (!isSortOnlyChange(captured.queryPlan, nextPlan)) {
    throw new TypeError(
      "Synchronous rebuild requires a sort-only plan change.",
    );
  }
  if (nextPlan.query.rowGroups.length > 0) {
    throw new TypeError("Synchronous rebuild requires an ungrouped query.");
  }
  const startedAt = now();
  const rowsDraft = captured.rows.asTransient();
  const visible: RowRecord<TRow, TRowId, TColumns>[] = [];
  for (const entry of captured.sourceOrder.entries()) {
    const previous = captured.rows.get(entry.rowId);
    if (previous === undefined) continue;
    const metadata = resortRecordMetadata(
      nextPlan,
      previous.metadata as never,
    ) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...previous, metadata });
    rowsDraft.set(record.rowId, record);
    if (metadata.filterPasses) visible.push(record);
  }
  const compareRows = nextPlan.compareRows as unknown as (
    left: RowRecord<TRow, TRowId, TColumns>["metadata"],
    right: RowRecord<TRow, TRowId, TColumns>["metadata"],
  ) => number;
  // The composite (compareRows, then id) mirrors the tree's own total order;
  // the bulk constructor verifies it and would throw on divergence.
  visible.sort(
    (left, right) =>
      compareRows(left.metadata, right.metadata) ||
      compareOrderStatisticTreeIds(left.rowId, right.rowId),
  );
  const tree = createOrderStatisticTreeFromSortedEntries(
    instrumentOrderStatisticTree(
      createFlatVisibleTree<TRow, TRowId, TColumns>(compareRows),
      instrumentation,
    ),
    visible,
  );
  const root = Object.freeze({
    revision,
    parentRevision: revision - 1,
    rows: rowsDraft.freeze(),
    sourceOrder: captured.sourceOrder,
    visible: Object.freeze({ rows: tree }),
    queryPlan: nextPlan,
    expansion: captured.expansion,
    cause: Object.freeze({ kind: "set-query" as const }),
  });
  if (instrumentation !== undefined) {
    instrumentation.work.synchronousRebuilds += 1;
    instrumentation.work.synchronousRebuildMs += Math.max(
      0,
      now() - startedAt,
    );
  }
  return root;
}
```

Check against reality before finishing: the exact `RevisionRoot` field set (read `internal-types.ts` — if it has fields beyond the eight above, carry them from `captured`), whether `sourceOrder.entries()` is the iteration API the cooperative path uses (it is — `cooperative-transition.ts:436`), whether `instrumentPersistentMap` should wrap the rows draft path (mirror what the cooperative candidate does at line 356), and whether the `cause` shape matches what `runTransitionSlice` publishes. Do not add this module to `index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/row-model/src/sort-rebuild.ts packages/row-model/src/diagnostics.ts packages/row-model/src/__tests__/sort-fast-path.test.ts
git commit -m "feat(row-model): synchronous whole-root rebuild for sort-only changes"
```

---

### Task 5: Wire the fast path into `setQuery`

**Files:**
- Modify: `packages/row-model/src/create-local-row-model.ts:1099-1138` (the `setQuery` method)
- Test: `packages/row-model/src/__tests__/sort-fast-path.test.ts` (extend)

The branch goes after the `nextPlan === queryPlan` short-circuit and before `startTransition`. On error it must reproduce `failTransition`'s observable semantics (error status carrying this transition id, rejected `finished`, root unchanged) without a transition object.

- [ ] **Step 1: Write the failing tests**

Extend `sort-fast-path.test.ts`, using the `ManualScheduler` class from `transitions.test.ts` (import it if exported; otherwise copy the minimal shape — schedule pushes, flush drains):

```ts
describe("setQuery sort-only fast path", () => {
  // Shared fixture: flat model, filter active, aggregate column, 8 rows,
  // ManualScheduler injected via transitionScheduler, instrumentation
  // attached the way work.test.ts attaches it.

  test("resolves synchronously without any scheduler task", async () => {
    // setQuery(sort-only change); assert scheduler.entries stays empty,
    // status.kind === "ready" immediately, snapshot shows the new order,
    // await transition.finished resolves to root.revision (old + 1),
    // instrumentation.work.synchronousRebuilds === 1.
  });

  test("mutation twin: a filter change takes the cooperative path", () => {
    // Same model; setQuery changing a filter value: scheduler.entries is
    // non-empty OR status.kind === "rebuilding", and synchronousRebuilds
    // stays 0. Proves the fast-path predicate can fail.
  });

  test("sorting still sorts (old behavior survives)", () => {
    // Assert the actual row order of the snapshot after the fast path against
    // the hand-computed expected permutation — not merely that the path ran.
    // Include a tie on the sort key: tied rows order by rowId.
  });

  test("supersedes an in-flight cooperative transition", async () => {
    // Start a filter-change transition (do NOT flush the scheduler), then a
    // sort-only setQuery. The first transition's finished rejects with
    // PretableTransitionCancelledError(reason "superseded"); the second
    // resolves; final snapshot reflects OLD filters + NEW sort (the fast path
    // rebuilt from the last committed root, not the abandoned candidate).
  });

  test("notifies subscribers exactly once", () => {});

  test("onQueryChange / snapshot.query reports the new sort", () => {});

  test("setRows immediately after a fast setQuery applies incrementally", () => {
    // After the fast path, a setRows update to one row must land in the
    // correct sorted position via the normal incremental path (the rebuilt
    // tree accepts later inserts — Task 2 proved the primitive; this proves
    // the wiring).
  });

  test("equivalence with a cold model", () => {
    // Model A: created with query Q1, setQuery(Q2 sort-only), flush nothing.
    // Model B: created directly with Q2 (cold build, same rows).
    // Assert identical visibleRowCount and identical rowAt(i) row identity
    // across the full range, and identical query snapshots.
  });

  test("accessor failure: error status carries the transition id, root unchanged", async () => {
    // Newly-active sort column whose accessor throws for one row. setQuery
    // must not throw synchronously; state.status matches the slow path's
    // shape: { kind: "error", transitionId: id, error: PretableRowModelError }.
    // finished rejects with the same error; snapshot still shows the OLD
    // order; a subsequent valid setQuery recovers.
    // FIRST write this test against the SLOW path (filter+sort change) to pin
    // the expected observable shape, then point it at the fast path.
  });
});
```

Write all of these as real tests with the shared fixture. Fixture discipline (memories: choose data that can disprove, assert the old behavior survives): old order, new order, and source order pairwise distinct — assert the controls inside the fixture setup; the mutation twin is mandatory, not optional.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: FAIL — fast-path assertions fail (scheduler receives tasks; `synchronousRebuilds` stays 0).

- [ ] **Step 3: Implement the branch**

In `setQuery` (`create-local-row-model.ts`), after the `nextPlan === queryPlan` block (line ~1124), insert:

```ts
if (
  isSortOnlyChange(queryPlan, nextPlan) &&
  nextPlan.query.rowGroups.length === 0
) {
  cancelActiveTransition("superseded");
  const previousRevision = root.revision;
  const revision = previousRevision + 1;
  let committedRoot: RevisionRoot<TRow, TRowId, TColumns>;
  try {
    committedRoot = rebuildRootForSortOnlyChange({
      captured: root,
      nextPlan,
      revision,
      now: transitionRuntime.now,
      instrumentation,
    });
  } catch (error) {
    const typed = transitionError(error, "set-query");
    state = Object.freeze({
      snapshot,
      status: Object.freeze({
        kind: "error" as const,
        transitionId: id,
        error: typed,
      }),
    });
    const finished = Promise.reject(typed);
    void finished.catch(() => undefined);
    return {
      transition: Object.freeze({
        id,
        requestedQuery: nextPlan.query,
        finished,
        cancel: () => cancelTransitionHandle(id, "set-query"),
      }),
      notify: true,
    };
  }
  queryPlan = committedRoot.queryPlan;
  query = committedRoot.queryPlan.query;
  derivations = committedRoot.queryPlan.derivations;
  commit(committedRoot, READY);
  distinctValues.publishTransitionRoot(committedRoot);
  changeJournal.appendBarrier(previousRevision, revision);
  return {
    transition: Object.freeze({
      id,
      requestedQuery: nextPlan.query,
      finished: Promise.resolve(revision),
      cancel: () => cancelTransitionHandle(id, "set-query"),
    }),
    notify: true,
  };
}
```

Imports: `isSortOnlyChange` from `"./compiled-query"`, `rebuildRootForSortOnlyChange` from `"./sort-rebuild"`.

Verify against the surrounding code while implementing: that `transitionError` (line ~694) is the right error mapper here (it is what `failTransition` uses); that reentrancy guards (`guarded("set-query", ...)` already wraps this) hold — the rebuild runs user accessors, and a reentrant `setRows` from inside an accessor must hit the same reentrancy error the slow path produces (add a test if `guarded` covers it; read how `guarded` detects reentrancy first); and that no `queryPlan.query.rowGroups` check is needed for the previous plan (`isSortOnlyChange` already proved groups unchanged, so checking `nextPlan` alone suffices).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/row-model test -- sort-fast-path`
Expected: PASS, including the error-path and supersede tests.

- [ ] **Step 5: Full package suite**

Run: `pnpm --filter @pretable-internal/row-model test`
Expected: PASS. Pay attention to `transitions.test.ts` and `work.test.ts` — any test that asserted a sort-only `setQuery` schedules cooperative work will now fail; each such failure is a deliberate behavior change. Update those tests to either use a non-sort-only change (when the test's subject is the cooperative machinery) or assert the new synchronous behavior (when the test's subject is sorting). Record every such edit in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/row-model/src/create-local-row-model.ts packages/row-model/src/__tests__/
git commit -m "feat(row-model): sort-only setQuery completes synchronously on flat queries"
```

---

### Task 6: Repo-wide verification and gate accounting

**Files:**
- Possibly modify: `apps/bench` gate config (comment only), package api reports

- [ ] **Step 1: Find the slice-bound gate and annotate it**

Run: `grep -rn "rebuild_slice_max_ms" apps/bench --include="*.ts" -l`

At the gate's definition site, add a comment (not a threshold change):

```ts
// The flat sort fast path (#457) is synchronous BY DESIGN and reports under
// work.synchronousRebuildMs, never as a scheduler slice — it is exempt from
// this bound. Grouped and non-sort-only transitions remain governed by it.
```

Confirm by reading the gate's data source that it consumes `schedulerSliceDurations` (which the fast path never touches), so the exemption is structural, not aspirational.

- [ ] **Step 2: Repo-wide checks**

Run, in order (build BEFORE api — stale `dist/` silently strips exports):

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm api
```

Expected: all green; `pnpm api` produces no report diff (`git status` clean on `*.api.md`) because nothing new is exported from any package index. If a report changed, something leaked into a public surface — fix the export, don't commit the report.

Note (memory: local test flakes): the react vitest suite times out 1–2 random tests per full run locally; re-run a failure once before investigating.

- [ ] **Step 3: Commit (gate comment only, if any)**

```bash
git add apps/bench
git commit -m "docs(bench): note the sort fast path's designed exemption from the slice bound"
```

---

### Task 7: Performance verification (the actual success gate)

**Files:** none committed except the scratch script's results pasted into the PR body.

The spec's bar: browser-measured, S2 sort at target scale `completed ×3` with `interaction_latency_ms` within ~2x of TanStack's in the same run; no regression at 3k; Node decomposition rerun as work accounting.

- [ ] **Step 1: Node decomposition (work accounting, informational)**

Write a scratch script (in the session scratchpad, NOT committed) that mirrors #457's methodology: `createLocalRowModel` + the S2 dataset generator from `apps/bench` (find it: `grep -rn "S2" apps/bench/src --include="*.ts" -l`), 50,000 rows, apply the S2 sort interaction, await `finished`, report wall time. Run against this branch's build.

Expected: wall time drops from ~515ms to double-digit milliseconds. Record before/after numbers.

- [ ] **Step 2: Browser bench — protocol**

Memories that bind this step: **bench A/B — change ONE thing** (the two sides must be this branch vs its merge-base, each with `packages/react` dist rebuilt before measuring); **bench port collision** (ensure no parallel session holds the bench port — check `lsof -i :4173` first and isolate if held); **check load** (quiet machine; run the control twice and check spread before trusting any comparison).

```bash
# side A: merge-base
git worktree list  # confirm you are in the task worktree
pnpm build
pnpm bench:matrix --adapters=pretable,tanstack --scenarios=S2 --scripts=sort --scale=target --repeats=3
# record, then side B: this branch, rebuild, rerun identically
```

Check the actual flag names against `apps/bench` docs/scripts before running (`--scale=target` vs however target scale is spelled; #457 used the words "target" and "hypothesis").

Also run the 3k guard: same command with `--scale=hypothesis`, plus `--scripts=filter-metadata` once to confirm no collateral change on a non-sort interaction.

- [ ] **Step 3: Evaluate against the spec bar**

- 50k: pretable `completed ×3`, latency ≤ ~2x TanStack's same-run latency.
- 3k: at or below the 50–59ms band from #457's A/B table.
- If the bar is missed: STOP, record the numbers, and report — the spec names the likely next lever (the residual is then in tree/map constants or renderer, and that is a finding, not a tweak-until-green situation). Do not chase the number by changing scheduling parameters; that lever is refuted.

- [ ] **Step 4: Grouped gate unaffected**

Run the bench script that exercises the grouped gate (the group script is comparative post-#477): confirm `rebuild_slice_max_ms` still passes and grouped sort latency is unchanged (it must be — grouped queries never enter the fast path; this run proves it).

---

### Task 8: PR and merge on green

- [ ] **Step 1: Re-check origin/main** (memory: parallel sessions)

```bash
git fetch origin main && git log --oneline HEAD..origin/main
```

If new commits touch `packages/row-model`, read them before rebasing; rebase and rerun the full package suite.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin blove/spec-457-cbb90d
gh pr create --title "feat(row-model): sort-only setQuery completes synchronously at TanStack-parity cost" --body "<summary: problem, decisions (synchronous by design, lever-1 refuted), measured before/after Node + browser numbers, equivalence-test strategy, gate exemption note. Closes #457. Reference the spec and #452.>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Merge on green**

Watch checks (`gh pr checks --watch`). Vercel quota memory applies: the preview smoke test is required; if the daily quota is exhausted, wait — do not bypass. On green, squash-merge. Then verify the merge actually happened (memory: never record an unverified merge state):

```bash
gh pr view --json state,mergedAt
git fetch origin main && git log --oneline -1 origin/main
```

---

## Self-review notes (already applied)

- Spec coverage: classifier → Task 1; carryover → Task 3; bulk build → Task 2; synchronous wiring + error semantics → Task 5; instrumentation/gate → Tasks 4/6; equivalence + mutation + old-behavior tests → Tasks 4/5; browser-measured success bar → Task 7. Deferred items (lever 4, filter path, grouped carryover) have no tasks by design.
- The one intentional deviation from the spec's literal text: the classifier compares runtime facets including both authorities (post-#467), amended in the spec.
- Type-consistency: `isSortOnlyChange`, `resortRecordMetadata`, `rebuildRootForSortOnlyChange`, `createOrderStatisticTreeFromSortedEntries`, `compareOrderStatisticTreeIds`, `work.synchronousRebuilds`, `work.synchronousRebuildMs` are the only new names; used consistently above.
- Known intentional looseness: fixture syntax in test code must be aligned with the package's real helper/API shapes at implementation time (called out inline in Tasks 1, 3, 4); the assertions are the contract.
