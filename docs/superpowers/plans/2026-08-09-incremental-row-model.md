# Incremental Row Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full local row derivation and full-array rendering with a strongly typed, persistent indexed row model that sustains grouped streaming over 100,000 local rows at 1,000 patches per second.

**Architecture:** Add `@pretable-internal/row-model` as the single owner of rows, query state, grouping, aggregation, expansion, revisions, and indexed snapshots. Keep grid-core responsible for UI state, give layout-core a persistent row-height index, and let renderer-dom/React request only the viewport range. Retain the current pure derivation temporarily as a differential oracle, then delete every production `visibleRows` path after the 20,000- and 100,000-row gates pass.

**Tech Stack:** TypeScript 6, pnpm workspaces, Vitest, fast-check, React 19, `useSyncExternalStore`, API Extractor, Playwright, persistent HAMT/treap structures implemented in-repo.

---

## Inputs and scope

- Design: `docs/superpowers/specs/2026-08-09-incremental-row-model-design.md`
- Before evidence: `docs/research/2026-08-08-row-grouping-streaming-benchmark.md`
- Deferred grouping adoption: `docs/superpowers/plans/2026-08-08-row-grouping-docs-hero-bench.md` Tasks 5–6
- Hashbrown type references:
  - `/Users/blove/repos/hashbrown/packages/core/src/utils/types.ts`
  - `/Users/blove/repos/hashbrown/packages/core/src/schema/base.ts`
  - `/Users/blove/repos/hashbrown/packages/core/src/schema/standard-json-schema.ts`
  - `/Users/blove/repos/hashbrown/packages/react/src/hooks/use-tool.tsx`

This is one project, not several independent plans: persistent data structures,
the model, grid ownership, indexed layout, React, and the browser gate form one
dependency chain. Each task below leaves the repository buildable and has its
own commit. Temporary side-by-side internals are permitted only during the
migration; no compatibility API or materializing adapter survives Task 23.

## Locked implementation decisions

1. Create `packages/row-model`. Do not add the new engine to
   `packages/grid-core/src/create-grid-core.ts`; grid-core must depend on the row
   model, never the reverse.
2. Implement the narrow persistent structures in-repo. Do not introduce a
   general database/index library.
3. Treat input rows as immutable values. Development builds freeze shallow row
   objects when practical and warn on same-reference content mutation; captured
   snapshots cannot protect callers who mutate an object behind the model.
4. Initial revision is `0`. The first successful mutation is revision `1`.
   `indexOf` returns `-1` when absent; `range(start,end)` clamps to
   `[0, visibleRowCount]` and is half-open.
5. Repeated updates for one ID are coalesced in input order and count as one
   `updated` or `unchanged` row. Removing then adding the same ID in one
   transaction is an atomic conflict; a later transaction may reuse the ID with
   a new monotonic source-order token.
6. Custom aggregate equivalence requires the documented homomorphism law:
   merging independently accumulated partitions must equal accumulating their
   concatenated rows. Add a development diagnostic for violated test samples.
7. The model retains its fixed typed column schema and the original structurally
   compatible column objects. `getColumns()` supplies the presentation fallback
   for `<PretableSurface rowModel={model} />`. Model mode may optionally pass
   compatible presentation-only column overrides; it cannot replace accessors,
   comparators, aggregators, filters, or IDs.
8. Add indexed snapshot primitives needed by UI without hidden scans:
   `visibleDataRowCount`, `dataRowAt`, `firstDataRow`, `lastDataRow`,
   `nextDataRow`, `previousDataRow`, `parentGroupOf`, and
   `nearestVisibleRef`. They share the same persistent counts/ranks.
9. Change operations are discriminated and carry exact placement:

   `insert { ref, index }`, `remove { ref, previousIndex }`,
   `move { ref, previousIndex, index }`, and
   `update { ref, index, fields }`. Operations are expressed sequentially in
   application order. Bulk query/expansion/root replacement returns `reset`.

10. The render controller owns the atomic pair of model snapshot and height
    root. React observes that pair, so it never combines revision N rows with
    revision N-1 geometry.
11. Offscreen rows use uniform type-based estimates. Wrapped-content estimation
    is performed only for the requested window; measured heights are retained
    by discriminated row ref and scroll anchoring absorbs corrections.
12. `createGridUiCore({ rowModel, columns })` owns only UI/presentation state.
    Grid subscriptions do not proxy raw model notifications. The React hook
    subscribes to grid, model status, and the render controller explicitly, and
    calls the internal `observeRowModelRevision(revision)` only after the render
    controller publishes the matching layout root.
13. Select-all is represented as `all visible data rows + exclusions` rather
    than N one-row ranges. Snapshot count/rank primitives keep header state and
    selection summaries sublinear.
14. Rows-mode edits emit a typed proposal and wait for the next `rows` prop.
    Explicit-model edit or paste validates the whole batch, calls one optional
    `beforeRowChange(batch)` hook, then publishes one transaction.
15. A new controlled query prop supersedes any older rebuild. UI proposals
    remain callback-only until the prop changes; `setQuery` cancels the older
    candidate before starting the new one.
16. `connectPartialStream` requires either a pre-existing row ID or an explicit
    `createRow(partial,id)` factory. It never fabricates a `TRow` from a partial.
17. Use fast-check with committed seeds/replay paths for differential tests.
    Use deterministic work counters—not wall time—for unit performance gates.
18. Preserve `S5 target = 20_000` and add `local-max = 100_000`. The flat and
    grouped runs share one seeded, typed patch plan; `col_3` receives numeric
    values and `col_1` retains unique group-key churn. Grouped runs explicitly
    start expanded.
19. Keep the API Extractor TypeScript-version warning for this project; do not
    combine an API Extractor upgrade with the engine migration.
20. `setRows` order is authoritative source order. Same-reference rows reuse
    cached query metadata; changed references reevaluate it. A group retained in
    the all-row tree is a known group even when filters currently hide it, so an
    explicit expansion override can survive its return.

## File structure

### New row-model package

- `packages/row-model/package.json` — internal package scripts and metadata.
- `packages/row-model/tsconfig.json`,
  `packages/row-model/tsconfig.typecheck.json` — build/test declaration projects.
- `packages/row-model/src/types.ts` — public structural model contracts.
- `packages/row-model/src/column-types.ts` — helper/carrier/inference types.
- `packages/row-model/src/errors.ts` — structured errors and cancellation.
- `packages/row-model/src/persistent/transient.ts` — edit-token draft lifecycle.
- `packages/row-model/src/persistent/persistent-map.ts` — ID-keyed HAMT.
- `packages/row-model/src/persistent/order-statistic-tree.ts` — persistent
  deterministic treap with rank/range and cached measures.
- `packages/row-model/src/persistent/aggregate-tree.ts` — mergeable leaf rollups.
- `packages/row-model/src/compiled-query.ts` — typed query dependency compiler.
- `packages/row-model/src/row-store.ts` — canonical persistent row records.
- `packages/row-model/src/group-index.ts` — memberships, counts, dual rollups.
- `packages/row-model/src/visible-index.ts` — indexed visible/data-row views.
- `packages/row-model/src/transaction-draft.ts` — atomic changed-path mutations.
- `packages/row-model/src/change-journal.ts` — bounded consumer change history.
- `packages/row-model/src/cooperative-transition.ts` — rebuild/delta catch-up.
- `packages/row-model/src/distinct-values.ts` — bounded async dictionaries.
- `packages/row-model/src/diagnostics.ts` — opt-in internal work counters.
- `packages/row-model/src/create-local-row-model.ts` — lifecycle and publication.
- `packages/row-model/src/index.ts` — curated internal exports.

### Tests and public typing

- `packages/row-model/src/__tests__/*.test.ts` — primitive and model unit tests.
- `packages/grid-core/src/__tests__/row-model/{oracle,arbitraries,fixtures}.ts`
  and `differential.test.ts` — temporary legacy comparison.
- `type-tests/` — declaration-facing positive/negative and 100/500-column gates.
- `scripts/check-type-performance.mjs` and its test — deterministic diagnostic
  budget parser.

### Grid, layout, renderer, and React

- `packages/layout-core/src/row-height-index.ts` — persistent measured-height tree.
- `packages/renderer-dom/src/row-layout-controller.ts` — revision/layout owner.
- `packages/grid-core/src/create-grid-ui-core.ts`,
  `indexed-selection.ts`, `indexed-focus.ts` — new UI-only engine.
- `packages/react/src/use-local-row-model.ts`,
  `use-pretable-columns.ts`, `use-indexed-pretable.ts`, `row-change.ts` — model
  ownership and React integration.
- Existing public wrappers and `pretable-surface.tsx` migrate after these
  side-by-side internals are green.

## Task 1: Restore and record the API baseline

**Files:**

- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Prove the pre-existing report drift.**

  Run: `pnpm --filter @pretable/react api:check`

  Expected: FAIL only because the committed report omits the already-landed
  grouping props; record the diff in the task notes.

- [ ] **Step 2: Regenerate the current report without feature changes.**

  Run: `pnpm --filter @pretable/react api`

- [ ] **Step 3: Verify the baseline.**

  Run:

  `pnpm --filter @pretable/react api:check && pnpm api:check`

  Expected: exit 0 apart from the existing informational TS 5.9/6.0 warning.

- [ ] **Step 4: Commit.**

  `git add packages/react/react.api.md && git commit -m "chore(api): refresh react report baseline"`

## Task 2: Scaffold the internal row-model package and type contract

**Files:**

- Create: `packages/row-model/package.json`
- Create: `packages/row-model/tsconfig.json`
- Create: `packages/row-model/tsconfig.typecheck.json`
- Create: `packages/row-model/src/types.ts`
- Create: `packages/row-model/src/column-types.ts`
- Create: `packages/row-model/src/errors.ts`
- Create: `packages/row-model/src/index.ts`
- Create: `packages/row-model/src/__tests__/types.test.ts`
- Modify: `packages/grid-core/package.json`
- Modify: `packages/grid-core/tsconfig.json`
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsup.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create the package shell and write compile-time contract tests.**

  Create `package.json` with working `test`, `build`, and `typecheck` scripts
  before invoking pnpm, plus the two tsconfigs and a test that imports the still-
  missing contract. Cover `TRow extends object`, string/number IDs, the opaque
  carrier, `RowOf/RowIdOf/ColumnsOf`, discriminated visible refs, status,
  mutation result/issues, query and derivation transitions, expansion policy,
  exact change operations, and disposal signatures. Runtime range/lifecycle
  behavior belongs to Task 7 after a model exists.

  Representative fixture:

  ```ts
  interface Holding {
    id: number;
    sector: string;
    quantity: number;
  }
  const column = createColumnHelper<Holding>();
  const columns = [
    column.accessor("sector", { type: "text" }),
    column.accessor("quantity", { type: "number", aggregate: "sum" }),
  ] as const;
  type Ids = ColumnIdOf<typeof columns>;
  type _ids = Expect<Equal<Ids, "sector" | "quantity">>;
  // @ts-expect-error number filters cannot use text-only contains
  const bad: PretableQueryFor<typeof columns> = {
    filters: [{ columnId: "quantity", operator: "contains", value: "4" }],
    sort: [],
    rowGroups: [],
  };
  ```

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model --fail-if-no-match test`

  Expected: the package is matched and the fixture FAILS on missing exports;
  zero executed test files is not an acceptable RED result.

- [ ] **Step 3: Add the minimal complete contract.**

  Use Hashbrown's `Prettify`, `const` generic, conditional inference, opaque
  carrier, and dependency-list patterns. Do not use recursive union-to-tuple
  machinery. Define the snapshot's data-row navigation and ancestor helpers
  now so later UI work never invents scans.

- [ ] **Step 4: Build and typecheck.**

  Run:

  `pnpm --filter @pretable-internal/row-model test && pnpm --filter @pretable-internal/row-model typecheck && pnpm --filter @pretable-internal/grid-core typecheck`

  Expected: all exit 0.

- [ ] **Step 5: Commit.**

  `git add packages/row-model packages/grid-core/package.json packages/grid-core/tsconfig.json packages/core/package.json packages/core/tsup.config.ts pnpm-lock.yaml && git commit -m "feat(row-model): define typed indexed contract"`

## Task 3: Implement persistent map drafts

**Files:**

- Create: `packages/row-model/src/persistent/transient.ts`
- Create: `packages/row-model/src/persistent/persistent-map.ts`
- Create: `packages/row-model/src/__tests__/transient.test.ts`
- Create: `packages/row-model/src/__tests__/persistent-map.test.ts`
- Modify: `packages/row-model/src/index.ts`

- [ ] **Step 1: Write failing invariant tests.**

  Test empty/get/set/delete/iterate, string and number keys, forced hash
  collisions, no-op root identity, old-root immutability, repeated draft edits,
  freeze safety, and structural-sharing diagnostics.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/transient.test.ts src/__tests__/persistent-map.test.ts`

  Expected: FAIL on missing constructors.

- [ ] **Step 3: Implement the narrow HAMT.**

  Use 5-bit hash fragments, bitmap-indexed nodes, leaf collision buckets, and
  an edit token on transient-owned nodes. Export only:

  ```ts
  interface PersistentMap<K extends string | number, V> {
    readonly size: number;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): PersistentMap<K, V>;
    delete(key: K): PersistentMap<K, V>;
    asTransient(): TransientMap<K, V>;
    entries(): IterableIterator<readonly [K, V]>;
  }
  ```

- [ ] **Step 4: Run GREEN and the package gate.**

  Run:

  `pnpm --filter @pretable-internal/row-model test && pnpm --filter @pretable-internal/row-model typecheck`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src/persistent packages/row-model/src/__tests__ packages/row-model/src/index.ts && git commit -m "feat(row-model): add persistent map drafts"`

## Task 4: Implement the order-statistic tree

**Files:**

- Create: `packages/row-model/src/persistent/order-statistic-tree.ts`
- Create: `packages/row-model/src/__tests__/order-statistic-tree.test.ts`
- Modify: `packages/row-model/src/index.ts`

- [ ] **Step 1: Write failing tree tests.**

  Cover deterministic priorities, comparator order, stable ID tie-breaks,
  insert/replace/remove, `entryAt`, `rankOf`, bounded `range`, subtree counts,
  cached generic measures, old-root immutability, and one transient batch.
  Compare randomized operations with a sorted array oracle.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/order-statistic-tree.test.ts`

- [ ] **Step 3: Implement a deterministic persistent treap.**

  Priority derives from the stable ID hash, never `Math.random`. Cache subtree
  count and a caller-provided associative measure. Draft rotations may mutate
  edit-token-owned nodes; frozen roots never do.

- [ ] **Step 4: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src/persistent/order-statistic-tree.ts packages/row-model/src/__tests__/order-statistic-tree.test.ts packages/row-model/src/index.ts && git commit -m "feat(row-model): add persistent order index"`

## Task 5: Implement mergeable aggregate trees

**Files:**

- Create: `packages/row-model/src/persistent/aggregate-tree.ts`
- Create: `packages/row-model/src/aggregator-law.ts`
- Create: `packages/row-model/src/__tests__/aggregate-tree.test.ts`
- Create: `packages/row-model/src/__tests__/aggregator-law.test.ts`
- Modify: `packages/row-model/src/index.ts`

- [ ] **Step 1: Write failing aggregate tests.**

  Cover insert/remove/replace, empty identity, logarithmic merge counts,
  filtered/all populations, built-in sum/avg/min/max/count, a custom monoid,
  and old-root immutability. Add a deliberately invalid custom aggregator whose
  sequential fold differs from merged one-row partitions; assert development
  validation reports its column ID and suppresses duplicate warnings.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/aggregate-tree.test.ts src/__tests__/aggregator-law.test.ts`

- [ ] **Step 3: Implement rollups over the order tree.**

  Each leaf stores the accumulator produced from one row. Internal nodes cache
  `merge(left, self, right)`. Keep finalized output outside tree comparison and
  reuse it by identity while its accumulator root is unchanged. In development,
  retain at most eight representative leaf samples per custom aggregator and
  compare `finalize(sequential accumulate)` with `finalize(merge(one-row
accumulators))`; emit one structured diagnostic on mismatch. Production
  builds contain no sampling or comparison path.

- [ ] **Step 4: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src/persistent/aggregate-tree.ts packages/row-model/src/aggregator-law.ts packages/row-model/src/__tests__/aggregate-tree.test.ts packages/row-model/src/__tests__/aggregator-law.test.ts packages/row-model/src/index.ts && git commit -m "feat(row-model): add mergeable aggregate rollups"`

## Task 6: Freeze the legacy differential oracle and compile queries

**Files:**

- Create: `packages/grid-core/src/__tests__/row-model/oracle.ts`
- Create: `packages/grid-core/src/__tests__/row-model/fixtures.ts`
- Create: `packages/grid-core/src/__tests__/row-model/oracle.test.ts`
- Create: `packages/row-model/src/compiled-query.ts`
- Create: `packages/row-model/src/__tests__/compiled-query.test.ts`
- Modify: `packages/row-model/src/index.ts`

- [ ] **Step 1: Characterize the oracle before touching legacy derivation.**

  Wrap `deriveVisibleRows` without editing `derived-rows.ts`,
  `group-rows.ts`, `row-utils.ts`, `aggregators.ts`, or `group-id.ts`.
  Normalize output into discriminated refs and explicit expansion policies.
  Copy the existing edge fixtures for escaping, collator/numeric order,
  stable source ties, filtered aggregates, and group empty/return.

- [ ] **Step 2: Run the characterization tests.**

  Run: `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/row-model/oracle.test.ts`

  Expected: PASS against the untouched full derivation.

- [ ] **Step 3: Write RED query-compiler tests.**

  Assert active filter/group/sort/aggregate accessors, stable source-order
  tie-break, null policies, semantic identity, one evaluation per dependency,
  and typed leaf accumulators.

- [ ] **Step 4: Implement `compileQuery` and run GREEN.**

  Run:

  `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/compiled-query.test.ts && pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/row-model/oracle.test.ts`

- [ ] **Step 5: Commit.**

  `git add packages/grid-core/src/__tests__/row-model packages/row-model/src/compiled-query.ts packages/row-model/src/__tests__/compiled-query.test.ts packages/row-model/src/index.ts && git commit -m "test(row-model): freeze oracle and compile queries"`

## Task 7: Bootstrap immutable flat snapshots

**Files:**

- Create: `packages/row-model/src/internal-types.ts`
- Create: `packages/row-model/src/row-integrity.ts`
- Create: `packages/row-model/src/row-store.ts`
- Create: `packages/row-model/src/visible-index.ts`
- Create: `packages/row-model/src/create-local-row-model.ts`
- Create: `packages/row-model/src/__tests__/local-row-model-contract.test.ts`
- Create: `packages/row-model/src/__tests__/immutability.test.ts`
- Modify: `packages/row-model/src/index.ts`

- [ ] **Step 1: Write the flat snapshot contract tests.**

  Construct 100 rows and assert revision 0, stable `getState()` identity,
  `rowAt`/`dataRowAt`/`range`/`indexOf`, first/last/next/previous data rows,
  clamping, absent sentinels, number IDs, equal text between a data ID and a
  synthetic group ID, duplicate-ID rejection, and no notification during
  construction. Add the full disposal contract: the first disposal publishes
  exactly one final `disposed` state, detaches current listeners, later
  subscriptions return inert idempotent unsubscribers, repeated disposal is a
  no-op, `getState` and captured snapshots remain readable, and every mutation,
  query, derivation, expansion, distinct-value, and change command throws the
  structured disposed-model error (commands added later repeat this assertion
  in their own suites).

  Add row-integrity tests proving development ingestion shallow-freezes
  extensible row objects before publication. For non-extensible/proxied rows,
  store a shallow own-key/value fingerprint; if `setRows` receives the same
  reference with a changed fingerprint, emit one structured diagnostic and
  reevaluate it rather than treating it as unchanged.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/local-row-model-contract.test.ts src/__tests__/immutability.test.ts`

- [ ] **Step 3: Implement initial persistent roots.**

  Store:

  ```ts
  interface RevisionRoot<TRow, TRowId, TColumns> {
    readonly revision: number;
    readonly parentRevision: number | null;
    readonly rows: PersistentMap<TRowId, RowRecord<TRow, TRowId>>;
    readonly sourceOrder: OrderStatisticTree<SourceOrderKey<TRowId>, TRowId>;
    readonly visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
    readonly queryPlan: CompiledQuery<TRow, TColumns>;
    readonly expansion: ExpansionRoot;
    readonly cause: PretableRevisionCause;
  }
  ```

  Snapshot methods close over one root. Public data/group row objects are
  memoized in row/group records and reused while observable fields are equal.
  `row-integrity.ts` owns development-only shallow freeze/fingerprint behavior;
  production assumes the documented immutable-row contract and adds no scans.

- [ ] **Step 4: Run GREEN and typecheck.**

  Run:

  `pnpm --filter @pretable-internal/row-model test && pnpm --filter @pretable-internal/row-model typecheck`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): bootstrap immutable flat snapshots"`

## Task 8: Add atomic flat transactions, filtering, sorting, and setRows

**Files:**

- Create: `packages/row-model/src/transaction-draft.ts`
- Create: `packages/row-model/src/__tests__/transactions.test.ts`
- Create: `packages/row-model/src/__tests__/flat-query.test.ts`
- Create: `packages/row-model/src/__tests__/set-rows.test.ts`
- Modify: `packages/row-model/src/row-store.ts`
- Modify: `packages/row-model/src/visible-index.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`

- [ ] **Step 1: Write transaction RED tests.**

  Assert add/update/remove, partial merge, repeated-update coalescing, unknown
  issues, cross-list conflict, duplicate add, accessor failure rollback,
  monotonic source order, one revision/notification, no-op suppression, and
  unchanged captured snapshots. After disposal, `applyTransaction` throws the
  shared structured disposed-model error and publishes no further notification.

- [ ] **Step 2: Write flat query and `setRows` RED tests.**

  Cover filter entry/exit, multi-sort and stable ties, sort-key moves, typed
  query state, same-reference reuse, changed-reference reevaluation, one ID
  scan, reordered source positions, and atomic duplicate rejection. After
  disposal, `setRows` throws the shared disposed-model error.

- [ ] **Step 3: Run RED.**

  Run:

  `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/transactions.test.ts src/__tests__/flat-query.test.ts src/__tests__/set-rows.test.ts`

- [ ] **Step 4: Implement one draft/one publication.**

  Validate the entire transaction before acquiring transient roots. Reevaluate
  every active dependency for changed rows only. Filter/sort membership updates
  remove and reinsert only affected order entries. Publish the frozen root,
  result counts, stable state object, and one subscriber wake-up together.

- [ ] **Step 5: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 6: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): apply incremental flat transactions"`

## Task 9: Add incremental grouping, aggregation, and expansion

**Files:**

- Create: `packages/row-model/src/group-index.ts`
- Create: `packages/row-model/src/__tests__/grouping.test.ts`
- Create: `packages/row-model/src/__tests__/expansion.test.ts`
- Modify: `packages/row-model/src/transaction-draft.ts`
- Modify: `packages/row-model/src/visible-index.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`

- [ ] **Step 1: Write grouping RED tests.**

  Cover one/multi-level paths, escaping, data/group text-ID collision, sibling
  order, group-key churn, path pruning and return, filtered/all child counts,
  `aggregateFilteredRows` both ways, built-ins, custom monoids, stable public
  group/aggregate identity, and parent/nearest-ancestor lookup.

- [ ] **Step 2: Write expansion RED tests.**

  Cover collapsed/expanded/through-depth defaults, inclusive zero-based depth,
  sparse overrides, override removal when it equals the default, unknown group
  issues, future groups, and O(1)-style expand/collapse-all policy changes.
  After disposal, every expansion command and `setDerivations` throws the shared
  disposed-model error.

- [ ] **Step 3: Run RED.**

  Run:

  `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/grouping.test.ts src/__tests__/expansion.test.ts`

- [ ] **Step 4: Implement changed-path grouping.**

  A group node owns ordered child groups or leaves, post-filter/all descendant
  counts, dual aggregate roots, policy-aware visible counts, and stable output.
  A moved row removes its old path and inserts its new path in the same draft.
  Do not flatten or enumerate groups for bulk expansion defaults.

- [ ] **Step 5: Run GREEN plus legacy semantic suites.**

  Run:

  `pnpm --filter @pretable-internal/row-model test && pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/aggregators.test.ts src/__tests__/group-id.test.ts src/__tests__/group-rows.test.ts src/__tests__/grouping-engine.test.ts`

- [ ] **Step 6: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): update grouped paths incrementally"`

## Task 10: Publish revision change sequences

**Files:**

- Create: `packages/row-model/src/change-journal.ts`
- Create: `packages/row-model/src/__tests__/change-journal.test.ts`
- Modify: `packages/row-model/src/transaction-draft.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`
- Modify: `packages/row-model/src/types.ts`

- [ ] **Step 1: Write RED journal tests.**

  Assert exact sequential insert/remove/move/update indices, aggregate/count
  updates, parent/current revisions, ordered multi-row changes, bounded
  eviction, unknown revision, bulk replacement, no entry on failure/no-op,
  and independence from retained snapshot roots. The final disposed state is
  readable, but any command that requests or advances consumer change history
  after disposal throws the shared disposed-model error.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/change-journal.test.ts`

- [ ] **Step 3: Generate changes inside the transaction draft.**

  Do not diff whole roots after commit. Capture previous rank before each
  removal and resulting rank after each insertion in operation order. Return
  `reset` for global query/derivation/default-expansion replacement.

- [ ] **Step 4: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): publish bounded revision changes"`

## Task 11: Add cooperative query and derivation transitions

**Files:**

- Create: `packages/row-model/src/cooperative-transition.ts`
- Create: `packages/row-model/src/__tests__/transitions.test.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`
- Modify: `packages/row-model/src/compiled-query.ts`
- Modify: `packages/row-model/src/types.ts`

- [ ] **Step 1: Write RED tests with an injected scheduler.**

  Test bounded slices, old snapshot interactivity, progress status, explicit
  cancellation to ready, supersession that remains rebuilding, disposal,
  accessor/comparator/aggregator rollback, transactions during rebuild, delta
  catch-up, one atomic revision, and no partial candidate publication. After
  disposal, `setQuery`, `setDerivations`, and transition cancellation commands
  throw the shared disposed-model error; disposal itself cancels and releases
  the active candidate and delta journal before the final notification.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/transitions.test.ts`

- [ ] **Step 3: Implement scheduler-driven candidates.**

  The default scheduler uses `scheduler.postTask` when available and
  `MessageChannel` otherwise, with a small time budget checked between rows.
  Tests inject a manual scheduler. The candidate captures a row-store root;
  live commits append to a separate, unbounded-for-transition delta journal
  that is released on swap/cancel.

- [ ] **Step 4: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): rebuild queries cooperatively"`

## Task 12: Add bounded distinct-value dictionaries

**Files:**

- Create: `packages/row-model/src/distinct-values.ts`
- Create: `packages/row-model/src/__tests__/distinct-values.test.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`
- Modify: `packages/row-model/src/types.ts`

- [ ] **Step 1: Write RED tests.**

  Cover typed values/counts, all/filtered populations, search/range limits,
  explicit blank ordering, lazy and eager build, cooperative progress,
  cancellation/disposal, accessor identity keys, LRU eviction, and transaction
  catch-up without renderer/menu scans. After model disposal, a new distinct
  query must synchronously throw the same structured disposed-model error; an
  in-flight query must cancel, release its candidate dictionary, and reject.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/distinct-values.test.ts`

- [ ] **Step 3: Implement dictionaries on immutable row roots.**

  Use the transition scheduler and a value/count order tree. Once built, update
  retained dictionaries from transaction metadata. Do not reuse the bounded
  consumer change journal as a catch-up source.

- [ ] **Step 4: Run GREEN.**

  Run: `pnpm --filter @pretable-internal/row-model test`

- [ ] **Step 5: Commit.**

  `git add packages/row-model/src && git commit -m "feat(row-model): index distinct filter values"`

## Task 13: Prove semantics and bounded work

**Files:**

- Create: `packages/grid-core/src/__tests__/row-model/arbitraries.ts`
- Create: `packages/grid-core/src/__tests__/row-model/differential.test.ts`
- Create: `packages/row-model/src/diagnostics.ts`
- Create: `packages/row-model/src/__tests__/work.test.ts`
- Create: `packages/row-model/src/__tests__/retention.test.ts`
- Modify: `packages/row-model/src/persistent/persistent-map.ts`
- Modify: `packages/row-model/src/persistent/order-statistic-tree.ts`
- Modify: `packages/row-model/src/persistent/aggregate-tree.ts`
- Modify: `packages/row-model/src/row-store.ts`
- Modify: `packages/row-model/src/group-index.ts`
- Modify: `packages/row-model/src/transaction-draft.ts`
- Modify: `packages/row-model/src/cooperative-transition.ts`
- Modify: `packages/row-model/src/distinct-values.ts`
- Modify: `packages/row-model/src/create-local-row-model.ts`
- Modify: `packages/row-model/src/index.ts`
- Modify: `packages/grid-core/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add fast-check and write layered differential properties.**

  Run: `pnpm --filter @pretable-internal/grid-core add --save-dev fast-check`

  Generate valid/invalid add/update/remove/setRows, flat filter/sort, grouping,
  aggregate, expansion, query replacement, and concurrent-transition sequences.
  Compare every operation prefix through `rowAt`, `range`, `indexOf`,
  data-row navigation, group parents, query/expansion state, revision rules,
  and normalized issues. Commit fixed seeds and print fast-check replay paths.

- [ ] **Step 2: Run RED and diagnose semantic differences.**

  Run:

  `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/row-model/differential.test.ts`

  Expected: new properties initially expose any differences; fix production
  behavior unless the approved spec intentionally changed the old behavior.

- [ ] **Step 3: Add deterministic work counters and tests.**

  Counters: rows evaluated, HAMT nodes copied, order nodes copied, group nodes
  copied, aggregate merges, transition rows, and snapshot rows read.
  Compare the same 50-ID transaction at 10,000 and 100,000 rows. Row evaluation
  must be identical; structural work must remain within a documented logarithmic
  bound. Assert a 100-row `range` reads 100 outputs.

  Add deterministic retention counters for live revision roots, consumer-journal
  entries, transition candidates/deltas, and distinct dictionaries. After
  10,000 discarded revisions, repeated transition cancellation, and dictionary
  eviction, assert one live current root (plus explicitly retained snapshots),
  bounded journal/cache counts, and zero cancelled candidates/delta journals.
  Export an internal-only `createInstrumentedLocalRowModel` from
  `diagnostics.ts` that returns `{ model, diagnostics }`; normal public factory
  calls install no counters. The diagnostics handle can read counters and
  scheduler slice durations and can exercise real transitions/dictionaries
  only through the model's ordinary commands. Core must not re-export it.

- [ ] **Step 4: Run the complete engine proof.**

  Run:

  `pnpm --filter @pretable-internal/row-model test && pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/row-model`

  Expected: all properties and work bounds pass.

- [ ] **Step 5: Commit.**

  `git add packages/grid-core/package.json packages/grid-core/src/__tests__/row-model packages/row-model/src pnpm-lock.yaml && git commit -m "test(row-model): prove semantics and bounded work"`

## Task 14: Promote the typed public core API

**Files:**

- Create: `packages/core/src/create-local-row-model.ts`
- Create: `packages/core/src/create-column-helper.ts`
- Create: `type-tests/tsconfig.json`
- Create: `type-tests/shared/assert.ts`
- Create: `type-tests/core/columns.types.ts`
- Create: `type-tests/core/local-row-model.types.ts`
- Create: `type-tests/core/query-and-aggregate.types.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/public_api.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tsup.config.ts`
- Modify: `packages/core/core.api.md`
- Modify: `package.json`

- [ ] **Step 1: Write declaration-facing RED fixtures.**

  Build `@pretable/core`, then compile fixtures against
  `packages/core/dist/index.d.ts`. Cover:

  - ordinary interfaces without index signatures;
  - inferred conventional and explicit string/number IDs;
  - const column IDs and accessor values;
  - correlated filters/operators/values;
  - built-in aggregate restrictions;
  - custom accumulator/output into aggregate formatters;
  - opaque `RowOf/RowIdOf/ColumnsOf` inference;
  - typed transaction patches and invalid IDs.

  Run: `pnpm --filter @pretable/core build && pnpm exec tsc -p type-tests/tsconfig.json --noEmit`

  Expected: FAIL because the public exports are absent.

- [ ] **Step 2: Add thin public wrappers and curated exports.**

  Keep implementation declarations in the row-model package, add `@public`
  release tags at their source, and re-export structurally through core. Core's
  tsup `noExternal` includes both row-model and grid-core.

- [ ] **Step 3: Run type, runtime, and API GREEN.**

  Run:

  `pnpm --filter @pretable/core test && pnpm --filter @pretable/core typecheck && pnpm --filter @pretable/core build && pnpm exec tsc -p type-tests/tsconfig.json --noEmit && pnpm --filter @pretable/core api && pnpm --filter @pretable/core api:check`

  Inspect `core.api.md` for readable `Prettify`-flattened declarations.

- [ ] **Step 4: Commit.**

  `git add packages/core type-tests package.json && git commit -m "feat(core): expose typed local row model"`

## Task 15: Add compiler-performance gates

**Files:**

- Create: `type-tests/performance/columns-100.ts`
- Create: `type-tests/performance/columns-500.ts`
- Create: `type-tests/performance/tsconfig.100.json`
- Create: `type-tests/performance/tsconfig.500.json`
- Create: `type-tests/performance/budgets.json`
- Create: `scripts/check-type-performance.mjs`
- Create: `scripts/__tests__/check-type-performance.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the parser/budget RED tests.**

  Parse `tsc --extendedDiagnostics` output and gate `Instantiations` and memory.
  Report check time but never hard-gate wall clock. Tests cover missing metrics,
  malformed output, and over-budget failures.

- [ ] **Step 2: Run RED.**

  Run: `node --test scripts/__tests__/check-type-performance.test.mjs`

- [ ] **Step 3: Add generated 100/500-column fixtures.**

  Use explicit const tuples that exercise accessors, query unions, formatters,
  and model inference. Calibrate committed budgets from clean consecutive local
  runs with 20% headroom.

- [ ] **Step 4: Run GREEN twice.**

  Run:

  `pnpm typecheck:public && pnpm typecheck:performance && pnpm typecheck:performance`

  Expected: stable instantiation/memory values within budget.

- [ ] **Step 5: Commit.**

  `git add type-tests/performance scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs package.json && git commit -m "test(types): gate wide-column inference cost"`

## Task 16: Add the persistent row-height index

**Files:**

- Create: `packages/layout-core/src/row-height-index.ts`
- Create: `packages/layout-core/src/__tests__/row-height-index.test.ts`
- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/viewport-plan.ts`
- Modify: `packages/layout-core/src/index.ts`

- [ ] **Step 1: Write RED layout invariants.**

  Cover insert/remove/move/update by generic stable key, count/total-height,
  offset-to-index/index-to-offset, measurement retention across moves and
  collapse/reinsert, identical text for data/group keys, bulk root replacement,
  anchor preservation, and touched-node diagnostics.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/layout-core exec vitest run src/__tests__/row-height-index.test.ts`

- [ ] **Step 3: Implement a persistent measured-height tree.**

  Reuse the order-statistic concepts but keep layout-core dependency-free.
  Store default/estimated/measured height state and subtree pixel sums. Extend
  `planViewport` to accept the long-lived reader; do not build an array.

- [ ] **Step 4: Run GREEN.**

  Run:

  `pnpm --filter @pretable-internal/layout-core test && pnpm --filter @pretable-internal/layout-core typecheck`

- [ ] **Step 5: Commit.**

  `git add packages/layout-core/src && git commit -m "feat(layout): index persistent row heights"`

## Task 17: Add an indexed render controller beside the legacy renderer

**Files:**

- Create: `packages/renderer-dom/src/row-layout-controller.ts`
- Create: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`
- Modify: `packages/renderer-dom/src/create-renderer.ts`
- Modify: `packages/renderer-dom/src/types.ts`
- Modify: `packages/renderer-dom/src/index.ts`
- Modify: `packages/renderer-dom/package.json`
- Modify: `packages/renderer-dom/tsconfig.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write RED tests with fake indexed snapshots.**

  Assert the controller:

  - consumes exact change operations through `changesSince`;
  - calls `range` only for planned viewport + overscan;
  - retains measured heights on moves/collapse/reinsert;
  - uses different keys for equal data/group text IDs;
  - estimates only requested wrapped rows;
  - handles journal reset with a cooperative height-root build;
  - preserves an ID/ancestor/logical-neighbor anchor; and
  - publishes model revision and layout root atomically.

- [ ] **Step 2: Run RED.**

  Run: `pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/indexed-renderer.test.ts`

- [ ] **Step 3: Implement the stateful controller.**

  The controller subscribes to a row model, owns `RowHeightIndex`, and exposes a
  stable external-store state. `createDomRenderSnapshot` becomes a pure window
  projection over that state. Keep the legacy full-array entry point only until
  React switches in Task 20.

- [ ] **Step 4: Run GREEN.**

  Run:

  `pnpm --filter @pretable-internal/renderer-dom test && pnpm --filter @pretable-internal/renderer-dom typecheck`

- [ ] **Step 5: Commit.**

  `git add packages/renderer-dom packages/layout-core pnpm-lock.yaml && git commit -m "feat(renderer): project indexed row windows"`

## Task 18: Add the UI-only grid core

**Files:**

- Create: `packages/grid-core/src/create-grid-ui-core.ts`
- Create: `packages/grid-core/src/indexed-selection.ts`
- Create: `packages/grid-core/src/indexed-focus.ts`
- Create: `packages/grid-core/src/__tests__/indexed-selection.test.ts`
- Create: `packages/grid-core/src/__tests__/indexed-focus.test.ts`
- Create: `packages/grid-core/src/__tests__/grid-ui-core.test.ts`
- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/grid-core/src/index.ts`
- Modify: `packages/grid-core/package.json`
- Modify: `packages/grid-core/tsconfig.json`

- [ ] **Step 1: Write selection RED tests.**

  Cover data-only selection, all-plus-exclusions, filtered visibility, range
  membership by ranks, tri-state counts, group headers, disappearing endpoints,
  and no N-range allocation for select-all.

- [ ] **Step 2: Write focus RED tests.**

  Cover arrow/page/home/end/tab, group focus, parent navigation, collapse
  fallback, scroll-to-ref, missing rows, and equal text data/group refs.

- [ ] **Step 3: Write grid ownership RED tests.**

  Assert grid snapshot contains viewport/focus/selection/editing/column layout
  plus observed row-model revision, but no rows, filters, sort, grouping,
  expansion, transactions, distinct values, or `visibleRows`. Model changes do
  not wake grid subscribers before matching layout exists. Calling the internal
  `observeRowModelRevision` with the atomically rendered revision wakes once;
  UI changes also wake normally.

- [ ] **Step 4: Implement and run GREEN.**

  Run:

  `pnpm --filter @pretable-internal/grid-core exec vitest run src/__tests__/indexed-selection.test.ts src/__tests__/indexed-focus.test.ts src/__tests__/grid-ui-core.test.ts && pnpm --filter @pretable-internal/grid-core typecheck`

- [ ] **Step 5: Commit.**

  `git add packages/grid-core && git commit -m "feat(grid-core): separate indexed UI state"`

## Task 19: Add React ownership, overloads, and type fixtures

**Files:**

- Create: `packages/react/src/use-local-row-model.ts`
- Create: `packages/react/src/use-pretable-columns.ts`
- Create: `packages/react/src/use-indexed-pretable.ts`
- Create: `packages/react/src/__tests__/use-local-row-model.test.tsx`
- Create: `packages/react/src/__tests__/row-model-mode.test.tsx`
- Create: `packages/react/src/__tests__/controlled-query.test.tsx`
- Create: `type-tests/react/surface-modes.types.tsx`
- Create: `type-tests/react/model-inference.types.tsx`
- Modify: `packages/react/src/use-pretable.ts`
- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/public_api.ts`
- Modify: `packages/react/react.api.md`
- Modify: `packages/react/package.json`
- Modify: `packages/react/tsconfig.json`
- Modify: `packages/react/tsconfig.typecheck.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write runtime RED tests.**

  Assert one model per rows-mode mount, post-commit `setRows` and
  `setDerivations` reconciliation, disposal, model-mode non-ownership,
  presentation fallback/override, separate subscriptions, controlled
  `query + onQueryChange` callback-only behavior, transition supersession, and
  the atomic render-controller snapshot.

- [ ] **Step 2: Write declaration RED fixtures.**

  Cover rows/model mutual exclusion, incomplete controlled-query pairs,
  rows-mode `onRowChange`, model-mode `beforeRowChange`, inferred callbacks,
  compatible presentation columns, rejected derivation override, and
  `usePretableColumns(factory,deps)` literal/value preservation. A direct
  property accessor infers its patch automatically; an editable computed
  accessor must provide a typed `setValue({ row, value }) => Partial<TRow>`.
  Omitting it, returning the wrong row fields, or accepting the wrong value type
  is a compile-time error.

- [ ] **Step 3: Run RED.**

  Run:

  `pnpm --filter @pretable/react test -- src/__tests__/use-local-row-model.test.tsx src/__tests__/row-model-mode.test.tsx src/__tests__/controlled-query.test.tsx && pnpm typecheck:public`

- [ ] **Step 4: Implement the overloads and hooks.**

  `useIndexedPretable` is temporary internal plumbing. The public
  `usePretable` overloads delegate to it, returning
  `{ grid, rowModel, gridSnapshot, rowModelSnapshot, renderSnapshot, status }`.
  Do not mutate any external store during render. Add grid-core as an internal
  bundled React dependency and resolve its source/declarations in the build and
  typecheck projects; keep React's published dependency surface limited to its
  existing public packages.

- [ ] **Step 5: Run GREEN and refresh the API report.**

  Run:

  `pnpm --filter @pretable/react test && pnpm --filter @pretable/react typecheck && pnpm typecheck:public && pnpm --filter @pretable/react api && pnpm --filter @pretable/react api:check`

- [ ] **Step 6: Commit.**

  `git add packages/react type-tests/react pnpm-lock.yaml && git commit -m "feat(react): add rows and model ownership modes"`

## Task 20: Migrate the React surface and all interaction scans

**Files:**

- Create: `packages/react/src/row-change.ts`
- Create: `packages/react/src/__tests__/indexed-rendering.test.tsx`
- Create: `packages/react/src/__tests__/row-change.test.ts`
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/group-row.tsx`
- Modify: `packages/react/src/group-model.ts`
- Modify: `packages/react/src/use-cell-edit-controller.ts`
- Modify: `packages/react/src/copy.ts`
- Modify: `packages/react/src/paste.ts`
- Modify: `packages/react/src/filter-menu/FilterMenu.tsx`
- Modify: `packages/react/src/pretable.tsx`
- Modify: `packages/react/src/labeled-grid-surface.tsx`
- Modify: `packages/react/src/inspection-grid.tsx`
- Modify: affected tests under `packages/react/src/__tests__`
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/showcase/ColumnLayoutGrid.tsx`
- Modify: `apps/website/app/components/showcase/ScaleGrid.tsx`
- Modify: `apps/website/app/fixtures/grouping/page.tsx`
- Modify: `apps/website/content/examples/streaming-chat-grid/ChatGrid.tsx`
- Modify: `packages/stream-adapter/src/types.ts`
- Modify: `packages/stream-adapter/src/create-batcher.ts`
- Modify: `packages/stream-adapter/src/connect-element-stream.ts`
- Modify: `packages/stream-adapter/src/connect-partial-stream.ts`
- Modify: `packages/stream-adapter/src/public_api.ts`
- Modify: stream-adapter tests, README, and API report
- Modify: corresponding website tests

- [ ] **Step 1: Add failing no-scan render/interaction tests.**

  Use a snapshot spy that throws if callers request an unbounded range. Cover
  rendering, measurement, telemetry, header selection, focus/activation,
  shift-selection, group parent/collapse, scroll-to-row, editing, copy, paste,
  and selection announcements. Routine rendering may read only the viewport;
  copy/paste may read only the selected/output span.

  Editing cases must assert: rows mode enters `saving` before an async
  `onRowChange` runs, remains saving until the accepted `rows` prop contains the
  proposal, and returns to editing/error on rejection without a model revision;
  explicit-model mode awaits one `beforeRowChange(batch)`, commits exactly one
  transaction only after resolution, and leaves the revision unchanged on
  rejection. Test both automatic direct-field patches and a computed editable
  accessor whose typed `setValue` creates a multi-field patch.

  In the same RED batch, add stream-adapter tests proving RAF coalescing emits
  `update: [{ id, changes }]`, preserves number IDs, remains atomic after a
  thrown transaction, and targets a structural ID-generic `RowModelLike`.
  Existing partial-stream IDs update; missing IDs report an issue unless
  `createRow(partial,id)` yields a complete accepted row.

- [ ] **Step 2: Run the focused RED suites.**

  Run:

  `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/indexed-rendering.test.tsx src/__tests__/row-change.test.ts src/__tests__/focus-scroll.test.tsx src/__tests__/group-row-render.test.tsx src/__tests__/copy.test.ts src/__tests__/paste-map.test.ts && pnpm --filter @pretable/stream-adapter test`

- [ ] **Step 3: Replace every production `visibleRows` consumer.**

  Use `indexOf`/`rowAt`/bounded `range` and the data-row navigation/count
  helpers. Render/DOM/height keys use discriminated refs. Delete
  `visibleRowIndexById` and full data-row maps. Group parent lookup uses
  `parentGroupOf`. Copy serializes indexed selected spans; paste walks data rows
  from the anchor.

- [ ] **Step 4: Implement query, distinct, edit, and paste ownership.**

  Header/group/filter actions construct one complete next query. The enum menu
  cancels stale distinct queries and renders loading/error states. Rows-mode
  edit derives a patch from the direct field or required computed-accessor
  `setValue`, emits a proposal, and waits for prop reconciliation. Explicit
  model mode derives every patch, validates the entire edit/paste batch, enters
  `saving`, awaits `beforeRowChange(batch)`, then commits one transaction and
  closes the edit. Rejection restores the draft/error and commits nothing.

- [ ] **Step 5: Activate the new React path and migrate compiled consumers.**

  Rename `useIndexedPretable` internals into the public React path and delete the
  temporary hook. Update bench, hero, showcase, and grouping-fixture controlled
  query props in the same commit. Keep legacy headless `createGrid` and its old
  grid-core implementation temporarily for still-compiled headless examples;
  they are no longer used by React and are deleted in Task 23, not here.

- [ ] **Step 6: Retarget streaming atomically with the React switch.**

  Replace `GridLike` with ID-generic `RowModelLike` and the explicit
  `{ id, changes }` update shape. Missing partial-stream IDs require
  `createRow(partial,id)` or report an issue; never fabricate a full row.
  Migrate bench, HeroGrid, and ChatGrid to pass the row model. Run stream tests,
  typecheck, API generation/check, and the compiled app typechecks before
  committing. Do not leave an overloaded legacy batcher.

- [ ] **Step 7: Run React/core/grid/stream GREEN and grep for scans.**

  Run:

  `pnpm --filter @pretable-internal/grid-core test && pnpm --filter @pretable/core test && pnpm --filter @pretable/react test && pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/stream-adapter test && pnpm --filter @pretable/stream-adapter typecheck && pnpm --filter @pretable/stream-adapter api && pnpm --filter @pretable/stream-adapter api:check && pnpm --filter @pretable/app-bench typecheck && pnpm --filter @pretable/app-website typecheck`

  Run:

  `rg -n "visibleRows|distinctColumnValues|grid\.applyTransaction|grid\.setRows|grid\.setRowGroups" packages/react/src packages/renderer-dom/src packages/grid-core/src/create-grid-ui-core.ts packages/grid-core/src/indexed-selection.ts packages/grid-core/src/indexed-focus.ts`

  Expected: no occurrence in the migrated production paths. The legacy
  headless engine is intentionally outside this interim sweep and is deleted in
  Task 23.

- [ ] **Step 8: Commit.**

  `git add packages/grid-core packages/react packages/renderer-dom packages/stream-adapter apps/bench apps/website && git commit -m "feat(react): switch surfaces and streams to indexed rows"`

## Task 21: Make the 20k/100k workload deterministic and permanent

**Files:**

- Create: `apps/bench/src/update-plan.ts`
- Create: `apps/bench/src/__tests__/update-plan.test.ts`
- Create: `apps/bench/src/row-model-diagnostics.ts`
- Create: `apps/bench/src/__tests__/row-model-diagnostics.test.ts`
- Create: `scripts/bench-row-model-gate.mjs`
- Create: `scripts/__tests__/bench-row-model-gate.test.mjs`
- Modify: `packages/scenario-data/src/index.ts`
- Modify: `packages/scenario-data/src/__tests__/scenario-data.test.ts`
- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Modify: `apps/bench/src/__tests__/query-state.test.ts`
- Modify: `apps/bench/src/bench-runtime.ts`
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `apps/bench/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/bench/tests/bench.spec.ts`
- Modify: `scripts/bench-matrix.mjs`
- Modify: `scripts/__tests__/bench-matrix.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write RED scale and patch-plan tests.**

  Preserve `S5 target = 20_000`; add `local-max = 100_000`. Assert the same
  seed creates the same row-ID/column schedule for flat and grouped runs,
  `col_1` changes are unique group keys, `col_3` changes are numeric, exactly
  50 patches arrive every 50 ms at 1,000/sec, and grouped mode explicitly uses
  expanded initial state plus `col_3` sum. Define a deterministic grouped
  rebuild phase that reverses a secondary sort while streaming continues; it
  must preserve row/group counts while exercising candidate catch-up.

- [ ] **Step 2: Write RED gate-script tests.**

  Feed fixture summaries for flat/grouped × target/local-max. Reject missing,
  mismatched, incomplete, or stale summaries. Every summary must enforce
  `row_model_commit_p95_ms <= 8`. For both grouped summaries additionally
  enforce:

  ```text
  scroll_frame_p95_ms <= 16
  long_tasks_count === 0
  scroll_position_drift_px === 0
  visible_row_count_drift === 0
  rebuild_slice_max_ms <= 8
  rebuild_completed === true
  rebuild_responsive === true
  ```

  Define `rebuild_responsive` without slowing the engine: it is true when the
  rebuild completes within one 50 ms producer interval, or when a longer
  rebuild observes at least one normally scheduled stream commit and at least
  one scroll/input sample while status is `rebuilding`. In either case, reject
  a final deterministic checksum that omits any patch accepted during catch-up.

- [ ] **Step 3: Run RED.**

  Run:

  `pnpm --filter @pretable-internal/scenario-data test && pnpm --filter @pretable/app-bench test && node --test scripts/__tests__/bench-row-model-gate.test.mjs scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 4: Implement the deterministic plan and gate.**

  `bench:row-model:gate` runs four Playwright jobs serially, passes one seed,
  validates comparable metadata, preserves summaries/traces, and writes a
  concise milestone report. Time each synchronous `applyTransaction` boundary
  in the adapter, and instrument the cooperative scheduler's slice duration in
  diagnostics builds. During both grouped jobs, start the deterministic query
  rebuild while the 1,000/sec producer and scrolling/input sampling continue;
  record commits observed during rebuild, candidate completion, and the final
  row checksum. Raw artifacts remain ignored by repository policy.

  `row-model-diagnostics.ts` installs a bench-only controller only when the
  explicit diagnostics query flag is present. It exposes typed methods to read
  internal retention/work counters, apply the next seeded transaction, start
  and cancel query candidates, start and cancel distinct dictionaries, and
  churn journal/cache limits. The Pretable bench adapter directly depends on
  the internal row-model package and constructs its explicit model through
  `createInstrumentedLocalRowModel`; React and the stream adapter receive that
  same structural model instance. The controller never ships through a public
  package export, and the adapter removes it on unmount.

- [ ] **Step 5: Run harness GREEN without claiming performance yet.**

  Run:

  `pnpm --filter @pretable-internal/scenario-data test && pnpm --filter @pretable/app-bench test && node --test scripts/__tests__/bench-row-model-gate.test.mjs scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 6: Commit.**

  `git add apps/bench packages/scenario-data scripts package.json pnpm-lock.yaml && git commit -m "test(bench): add deterministic row-model gate"`

## Task 22: Pass the hard browser performance gate

**Files:**

- Create: `docs/research/2026-08-09-incremental-row-model-benchmark.md`
- Create: `status/milestones/2026-08-09-incremental-row-model-gate.json`
- Create: `scripts/bench-row-model-memory.mjs`
- Create: `scripts/__tests__/bench-row-model-memory.test.mjs`
- Modify: `apps/bench/src/row-model-diagnostics.ts` only if trace-driven memory
  observability requires a smaller controller method
- Modify: only the smallest engine/layout/render files demonstrated by traces
  and deterministic counters if the first run fails

- [ ] **Step 1: Build production artifacts.**

  Run: `pnpm --filter @pretable/app-bench build`

  Expected: exit 0.

- [ ] **Step 2: Run all four controlled artifacts.**

  Run: `pnpm bench:row-model:gate -- --project=chromium`

  Expected: flat and grouped summaries at 20,000 and 100,000 rows. Both grouped
  runs pass the four visual assertions plus the commit-latency, bounded-slice,
  live-stream catch-up, and completion assertions. Flat runs are recorded as
  controls and must pass the commit-latency assertion.

- [ ] **Step 3: If any gate fails, stop downstream work and diagnose.**

  Use `superpowers:systematic-debugging`. Compare the deterministic work
  counters first, then inspect the failing trace. Identify whether time is in
  transaction/query evaluation, aggregate merges, change application, range
  reads, height corrections, React reconciliation, or browser layout.
  Add a focused regression test before changing code. Do not lower the rate,
  row count, expansion, group-key churn, aggregation, or threshold.

- [ ] **Step 4: Repeat until the unchanged gate passes.**

  Every optimization receives its own focused RED/GREEN test and commit. Rerun
  the package containing the change, then the four-run gate. Do not proceed on
  a partial or one-off pass.

- [ ] **Step 5: Run the dedicated retention/memory proof.**

  First rerun `packages/row-model/src/__tests__/retention.test.ts` to prove
  exact internal ownership counts and run the memory sample parser test:

  `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/retention.test.ts && node --test scripts/__tests__/bench-row-model-memory.test.mjs`

  Then run the production browser under CDP with the explicit diagnostics flag:

  `node --expose-gc scripts/bench-row-model-memory.mjs`

  The script loads grouped `local-max`, warms through 2,000 unpublished old
  revisions through the bench-only controller, forces
  `HeapProfiler.collectGarbage`, and records five further 2,000-revision
  windows. Every window uses that controller to start/cancel real query
  candidates, cancel real distinct-value builds, and churn past both
  journal/cache limits before reading the model's internal counters.
  With no captured historical snapshots, assert zero retained candidates/delta
  journals, configured journal/dictionary bounds, final heap growth no greater
  than 16 MiB over the post-warmup baseline, and least-squares retained slope no
  greater than 256 bytes/revision. The unit test feeds synthetic samples to the
  slope/threshold parser. Record this as a dedicated release-machine gate, not
  a noisy shared-CI wall-time assertion.

- [ ] **Step 6: Record the evidence.**

  The research note contains commit, machine/browser metadata, seed, commands,
  artifact paths, all performance metric tables, engine work/retention
  counters, heap
  samples/slope, and PASS/FAIL. The exact milestone JSON summarizes the four
  browser artifacts and memory gate. Commit no ignored raw traces.

- [ ] **Step 7: Commit the passing gate.**

  `git add docs/research/2026-08-09-incremental-row-model-benchmark.md status/milestones/2026-08-09-incremental-row-model-gate.json scripts/bench-row-model-memory.mjs scripts/__tests__/bench-row-model-memory.test.mjs && git commit -m "perf(row-model): pass grouped local maximum gate"`

## Task 23: Remove legacy paths, migrate documentation, and resume grouping adoption

**Files:**

- Delete after extracting minimized regressions:
  - `packages/grid-core/src/create-grid-core.ts`
  - `packages/grid-core/src/derived-rows.ts`
  - `packages/grid-core/src/group-rows.ts`
  - `packages/grid-core/src/group-expansion.ts`
  - `packages/grid-core/src/derived-selection.ts`
  - `packages/grid-core/src/__tests__/row-model/oracle.ts`
  - `packages/grid-core/src/__tests__/row-model/arbitraries.ts`
  - `packages/grid-core/src/__tests__/row-model/differential.test.ts`
  - `packages/layout-core/src/prefix-sums.ts`
- Create: `packages/row-model/src/__tests__/properties.test.ts`
- Modify: matching exports and legacy tests in `packages/grid-core`,
  `packages/layout-core`, and `packages/renderer-dom`
- Modify: `packages/core/src/create-grid.ts`
- Modify: `packages/core/src/pretable-grid.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/public_api.ts`
- Modify: `packages/core/README.md`
- Modify: `packages/stream-adapter/README.md`
- Modify: `apps/website/content/docs/headless/{index,getting-started,state-model,mutations,api-reference}.mdx`
- Modify: `apps/website/content/docs/grid/{index,api-reference,custom-rendering,filtering,sorting,editing,clipboard,pretable-surface}.mdx`
- Modify: `apps/website/content/docs/streaming/{index,element-streams,partial-streams,api-reference}.mdx`
- Modify: `apps/website/content/examples/headless-custom-renderer/HeadlessTable.tsx`
- Modify: streaming examples under `apps/website/content/examples/streaming-chat-grid`
- Modify: `apps/website/app/bench/page.tsx`
- Modify: `apps/website/app/components/StreamingByDesign.tsx`
- Modify: `apps/website/__tests__/components/StreamingByDesign.test.tsx`
- Create: `apps/website/content/docs/grid/grouping.mdx`
- Modify: `apps/website/app/docs/_nav.ts` and its nav test
- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/heroGrid/positionColumns.tsx`
- Modify: hero tests and `apps/website/e2e/grouping.spec.ts`
- Modify: public API reports under `packages/{core,react,stream-adapter}`

- [ ] **Step 1: Convert useful differential failures into permanent fixtures.**

  Preserve minimized cases for escaping, group-key churn, custom aggregates,
  filtered totals, expansion return, transaction conflicts, and transition
  catch-up in row-model unit tests. Move the reusable fast-check generators into
  a permanent row-model property suite that asserts snapshot/index/revision
  invariants without the legacy engine. Then delete only the grid-core oracle
  adapter and oracle-comparison suite; keep property testing as a release gate.

- [ ] **Step 2: Delete every legacy production/materialization path.**

  Remove old derivation, old grid store, prefix sums, legacy renderer entry
  point, obsolete types/methods, and stale tests. Update exports, package
  references, and build configs. Switch public `createGrid` to
  `createGridUiCore({ rowModel, columns })` and delete grid-owned row/query/data
  mutation methods. There must be exactly one production row engine and one
  layout path.

- [ ] **Step 3: Write docs/example RED tests and migrate the breaking API.**

  Headless examples create a row model, use `snapshot.range`, and create a UI
  grid only when they need UI state. Streaming examples target `rowModel`.
  Remove all documentation of grid-owned rows/query state, synchronous
  distinct values, old partial updates, and `visibleRows`. Rewrite the Grid
  overview's `grid.applyTransaction` example and the StreamingByDesign card's
  obsolete “one transaction path” claim: rows props are the declarative path,
  while high-frequency producers explicitly target a row model.

- [ ] **Step 4: Resume the deferred hero and grouping guide only now.**

  Follow the behavioral assertions in
  `docs/superpowers/plans/2026-08-08-row-grouping-docs-hero-bench.md` Tasks 5–6,
  adapted to the new query/expansion API:

  - hero starts ungrouped with the empty grouping panel;
  - Sector can be grouped through the menu/drag UI;
  - qty, market value, and day P&L use typed sum aggregates/formatters;
  - grouping and aggregate changes survive streaming;
  - the sidebar stays leaf-row based; and
  - the hero bezel dimensions remain stable.

- [ ] **Step 5: Regenerate and inspect public API reports.**

  Run:

  `pnpm build && pnpm api && pnpm api:check`

  Expected: no `visibleRows`, grid-owned transaction/query methods, legacy
  `Record<string, unknown>` row constraint, or collision-prone row/group union.

- [ ] **Step 6: Run website and browser validation.**

  Run:

  `pnpm --filter @pretable/app-website test && pnpm --filter @pretable/app-website typecheck && pnpm --filter @pretable/app-website build`

  Then run the established production-server website grouping suite in
  Chromium and WebKit. Expected: PASS.

- [ ] **Step 7: Re-run the performance gate after docs/hero integration.**

  Run: `pnpm bench:row-model:gate -- --project=chromium`

  Expected: both grouped scales still pass the complete performance contract.

- [ ] **Step 8: Run final repository and packaging gates.**

  Run:

  `pnpm typecheck:public && pnpm typecheck:performance && pnpm typecheck && pnpm test && pnpm lint && pnpm format && pnpm build && pnpm api:check && pnpm lint:packaging`

  Expected: every command exits 0. `git diff --check` is clean.

- [ ] **Step 9: Prove no forbidden path remains.**

  Run:

  `rg -n "visibleRows|distinctColumnValues|grid\.applyTransaction|grid\.setRows|GridLike<|groupsDefaultExpanded|one transaction path" packages apps/website/content apps/website/app --glob '!**/CHANGELOG.md' --glob '!**/__tests__/**' --glob '!**/*.test.*' --glob '!type-tests/**'`

  Expected: no production/API/docs occurrences; historical research and old
  design documents are intentionally outside this sweep.

- [ ] **Step 10: Commit.**

  `git add packages apps/website package.json pnpm-lock.yaml && git commit -m "feat: complete incremental row-model migration"`

## Final verification checklist

- [ ] Routine 50-row transactions inspect only changed rows and logarithmic
      structural paths at 100,000 rows.
- [ ] Grouping, aggregation, sorting, filtering, expansion, revisions, and
      distinct values match the retained oracle before it is removed.
- [ ] Captured snapshots remain immutable; history retention is not automatic.
- [ ] Rows and explicit-model React modes infer row/ID/column/value types without
      repeated generics and cannot be mixed.
- [ ] Renderer/layout read only viewport-sized ranges during routine updates.
- [ ] Selection, focus, edit, copy, paste, telemetry, and group controls contain
      no hidden full-model scans.
- [ ] 100- and 500-column compiler budgets pass.
- [ ] 20k and 100k grouped browser gates pass at 1,000 patches/sec.
- [ ] The old engine, full `visibleRows` API, and compatibility shims are gone.
- [ ] Website docs/examples and the portfolio hero demonstrate the new API only
      after the performance gate.
