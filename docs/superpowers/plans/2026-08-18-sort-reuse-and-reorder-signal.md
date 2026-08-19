# Sort-Key Ownership + Reorder Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the 50k S2 sort from ~400ms to the end-to-end ~2x-of-TanStack bar by (A) moving sort keys out of per-row records so a sort-only change carries records/rows-map by identity, and (B) publishing an order-only journal signal so the renderer's height index permutes instead of re-ingesting 50k rows.

**Architecture:** Phase A restructures `packages/row-model`: `CompiledRowMetadata` loses `sortKeys`, each `CompiledQueryPlan` owns a WeakMap sort-key store, `compareRows` becomes record-based, four internal consumers reroute, `sort-rebuild.ts` v2 reuses records and the rows HAMT, `resortRecordMetadata` is deleted. Phase B adds reset reason `"reorder"` to the change journal (public union — old consumers fail closed to full replacement), a synchronous `RowHeightIndex.reorder()` in layout-core, and a permutation path in renderer-dom's row-layout controller.

**Tech Stack:** TypeScript, vitest per package, pnpm workspace, api-extractor gate (`pnpm build` then `pnpm api`), Playwright bench.

**Spec:** `docs/superpowers/specs/2026-08-18-sort-reuse-and-reorder-signal-design.md` — read it first. Cycle-1 spec for background: `docs/superpowers/specs/2026-08-17-sort-fast-path-design.md`.

**Facts established during spec work (verify only if something contradicts):**
- All `metadata.sortKeys` / `dependency` consumers are internal to row-model: `transaction-draft.ts:348` (`sameFlatOrder` → `sameKeyValues`), `group-index.ts:897-921` (`compareAggregateLeaves`, synthesizes fake metadata from `dependency.sortKeys`), `group-index.ts:855`, `persistent/aggregate-tree.ts:480` (`Object.is(left.dependency, right.dependency)`).
- `compareRows` call sites: `visible-index.ts` (38/64/89/100), `cooperative-transition.ts:406`, `transaction-draft.ts:1385`, `sort-rebuild.ts:55-71`, `group-index.ts:855,905`.
- Journal: `JournalEntry` barrier already carries `reason: ResetReason`; public reset reasons are `"unknown-revision" | "journal-evicted" | "bulk-replace"` (`types.ts:294`); `PretableChangeSequence`/`changesSince` are in `core.api.md` (259/1088).
- `changesSince` consumers: renderer-dom `row-layout-controller.ts` (`validateChanges:1400` — checks `sequence.kind !== "changes"` → replacement; already fail-closed for any reset reason) and `grid-core/create-grid-ui-core.ts` (audit in B2).
- Browser attribution: 192ms sync setQuery + ~215ms height-index re-ingest; React commit 5.3ms (`scratchpad/sort-browser-attribution.md`). Node attribution: `scratchpad/sort-residual-profile.md`.

**Conventions binding every task:** packages/* vanilla TS, no new deps. TDD: failing test first, red run shown, then green. Comments = constraints only. Mutation-harden every new load-bearing assertion (prove it can fail). Never `git checkout` in the main repo (`~/repos/pretable`); work only in this worktree. Amend-on-HEAD only after verifying HEAD.

---

## Phase A — sort keys move to the plan

### Task A1: Plan-owned sort-key store + record-based `compareRows` (dual-source transition state)

**Files:**
- Modify: `packages/row-model/src/compiled-query.ts`
- Test: `packages/row-model/src/__tests__/sort-key-store.test.ts` (create)

End state of this task: the plan owns a store and a record-based comparator; `metadata.sortKeys` STILL EXISTS (removed in A3) so the package stays green. The new comparator resolves through the store only.

- [ ] **Step 1: Write failing tests** (`sort-key-store.test.ts`)

Contracts (adapt fixture syntax from `query-delta.test.ts`):
1. `evaluate` populates the plan's store: after `plan.evaluate({rowId, row, sourceOrder})`, the new internal accessor (exported for tests as `getSortKeysForTesting(plan, row)` or via the comparator's observable behavior — prefer behavior: see test 2) resolves without running accessors again (spy-count proof, same style as cycle 1's carryover tests).
2. New `compareRecordRows(plan, left, right)` (working name; see Step 3) orders two evaluated inputs `{rowId, row, sourceOrder}` identically to the current metadata-based `compareRows` over the same fixture — table of pairs including: number column asc/desc, text collation, nulls first/last, custom comparator, sort-key tie resolving by `sourceOrder`.
3. Fail-loud: comparing a row the plan never evaluated (and whose keys were never swap-filled) throws (message naming the defect, e.g. "row has no sort keys under this plan").
4. Store swap-fill: `fillSortKeysFromPrevious(nextPlan, previousPlan, row)` (working name) carries values for overlapping sort columns from the previous plan's store and runs accessors only for newly-active sort columns (spy proof — this relocates cycle 1's carry rule; the carry source is the PREVIOUS PLAN'S STORE, not metadata).
5. Accessor failure during swap-fill surfaces the same `accessor-failed` `PretableRowModelError` shape `evaluate` uses.

- [ ] **Step 2: Red run**

`pnpm --filter @pretable-internal/row-model test -- sort-key-store` → FAIL (exports missing).

- [ ] **Step 3: Implement in compiled-query.ts**

- Private field on `CompiledQueryPlan`: `#sortKeys = new WeakMap<object, readonly CompiledSortKey<TColumns>[]>()`.
- `evaluate`: where `sortKeys` is built today (inside `#finalizeMetadata`), also `this.#sortKeys.set(input.row, sortKeys)`. (Metadata keeps carrying them until A3.)
- Static + free-function pattern (as in cycle 1) for:
  - `compareRecordRows(plan, left: {rowId; row; sourceOrder}, right)` — resolves both sides' keys from `plan.#sortKeys` (throw with a defect-naming message on miss), then runs the existing per-ordering comparison loop (`compareValues`) ending in the `sourceOrder` tiebreak. Refactor the existing `compareRows` body so both comparators share ONE loop implementation (parameterized on a key-lookup function) — do not fork the comparison semantics.
  - `fillSortKeysFromPrevious(nextPlan, previousPlan, input: {rowId; row; sourceOrder})` — for each entry of nextPlan's runtime sort: carry from `previousPlan.#sortKeys.get(row)` by columnId where present, else run the accessor (wrapped in the accessor-failed error shape); freeze and store into `nextPlan.#sortKeys`; return the keys. Statics can read both instances' privates.
- Do NOT change `compareRows`, metadata, or any consumer yet. No index.ts edits.

- [ ] **Step 4: Green + full suite**

Package suite green (376 + new). Commit:
```bash
git add packages/row-model/src/compiled-query.ts packages/row-model/src/__tests__/sort-key-store.test.ts
git commit -m "feat(row-model): plan-owned sort-key store and record-based comparator"
```

---

### Task A2: Reroute the four consumers to the store

**Files:**
- Modify: `packages/row-model/src/visible-index.ts`, `cooperative-transition.ts`, `transaction-draft.ts`, `group-index.ts`, `sort-rebuild.ts`
- Test: existing suites (behavior-neutral task) + targeted additions in `sort-key-store.test.ts`

Reroute every comparator/keys read to the store while `metadata.sortKeys` still exists. Behavior must be UNCHANGED — the whole existing suite is the test. This task makes A3 (shape removal) mechanical.

- [ ] **Step 1: Reroute, one call site at a time, running the package suite after each**

1. `visible-index.ts`: `createFlatVisibleTree` takes the PLAN (or a record comparator) instead of a metadata comparator; its tree `compare` becomes `compareRecordRows(plan, left, right)` over records (records carry rowId/row/sourceOrder directly — metadata no longer consulted). `createFlatVisibleIndex`/`createVisibleIndex` signatures adapt. Update callers (cooperative-transition.ts:404-412, sort-rebuild.ts).
2. `transaction-draft.ts:1385` (tree comparator) — same replacement. `sameFlatOrder` (~:346): replace `sameKeyValues(previous.metadata.sortKeys, next.metadata.sortKeys)` with a store-based comparison: previous keys from the PREVIOUS plan's store, next keys from the CURRENT plan's store (read the surrounding code to learn which plans are in scope there; if both records were evaluated under the same plan, both resolve from it). Preserve the exact `Object.is` value-equality semantics of `sameKeyValues`.
3. `group-index.ts:855` — record-based comparator.
4. `group-index.ts:897-921` `compareAggregateLeaves` — replace the synthesized-metadata hack with `compareRecordRows(queryPlan, {rowId: left.id, row: left.row, sourceOrder: leftDependency.sourceOrder}, ...)`. The store resolves keys by `row` object — the leaf carries `row`. (Leaves' rows were evaluated under this plan, so the store has them; if a test proves otherwise, that is a real finding — stop and report, do not lazily fill here.)
5. `sort-rebuild.ts` — comparator adaptation only (v2 rewrite is A3).

- [ ] **Step 2: Targeted additions**

In `sort-key-store.test.ts`: one test per rerouted site is NOT needed (the suite covers behavior); add exactly one integration test: build a model with groups + aggregates + sort, run a full setQuery cycle, assert output equals a pre-reroute oracle (hardcode the expected output from a green pre-change run — this pins that the reroute changed nothing).

- [ ] **Step 3: Full suite green, commit**

```bash
git add -A packages/row-model
git commit -m "refactor(row-model): resolve sort keys through the plan store everywhere"
```

---

### Task A3: Remove `sortKeys` from metadata and `dependency`; sort-rebuild v2; delete `resortRecordMetadata`

**Files:**
- Modify: `packages/row-model/src/compiled-query.ts`, `internal-types.ts` (if metadata type lives there — find `CompiledRowMetadata`'s definition), `sort-rebuild.ts`, `group-index.ts` (dependency construction), `transaction-draft.ts` (dependency comparisons ~:401-413, :704)
- Delete: `resortRecordMetadata` + its statics/tests
- Test: `sort-fast-path.test.ts` (rewrite affected describes), `sort-key-store.test.ts`

- [ ] **Step 1: Write the new-invariant tests FIRST** (they fail against A2 state)

In `sort-fast-path.test.ts`, the model-level fast-path describe gains/changes to:
1. **Identity carries:** after a sort-only `setQuery`, the new root's rows map is the SAME object (`toBe`) as before; every record and every `publicRow` is `toBe`-identical; `visibleRowCount` unchanged; order changed per the fixture's expected permutation. (Get the root via the same fixture path Task-4-cycle-1 used, or assert identity through the public snapshot: `rowAt(i)` returns identity-stable rows across the change.)
2. **Stale-hazard (the crown):** sort-only fast path, THEN `setRows` updating one row's sort-key value → the row re-ranks correctly; THEN `setRows` updating a non-key field → the row does NOT move (pins `sameFlatOrder` through the store). Both assertions against hand-computed expected orders with fixture controls.
3. **Aggregate-reuse:** with an aggregate column, sort-only change leaves every `aggregateLeaves[i].dependency` `toBe`-identical (per record identity this is implied — assert it anyway) AND aggregate VALUES still correct (positive twin).
4. **Work counters:** `synchronousRebuilds === 1`; new counters `sortKeyCarries + sortKeyEvaluations === rowCount` with carries dominating when sort columns overlap, evaluations > 0 when a new column enters the sort (two scenarios).
5. Existing equivalence/error/supersede tests from cycle 1 stay, with metadata-content assertions replaced by identity assertions where metadata no longer changes.

- [ ] **Step 2: Red run, then implement**

- `CompiledRowMetadata`: remove `sortKeys`; `dependency` becomes `Object.freeze({sourceOrder})` (in `#finalizeMetadata`); remove the now-dead `valueOf` plumbing for sort keys from the shared helper (keys now flow to the store, not metadata — evaluate still computes them, in the same place, storing to the WeakMap only).
- `transaction-draft.ts:401-413`: dependency comparison drops the sortKeys leg (dependency is now `{sourceOrder}`; read what the comparison protects — aggregate-leaf reuse — and keep the `sourceOrder` check; sort-key changes no longer dirty leaves BY DESIGN — the aggregate-reuse test pins correctness). `:704` spread adapts.
- `group-index.ts` dependency construction sites adapt.
- Delete `resortRecordMetadata`, `CompiledQueryPlan.resortMetadata`, and their describe block.
- `sort-rebuild.ts` v2:

```ts
// After the guards (unchanged):
const startedAt = now();
const visible: RowRecord<TRow, TRowId, TColumns>[] = [];
for (const entry of captured.sourceOrder.entries()) {
  const previous = captured.rows.get(entry.rowId);
  if (previous === undefined) continue;
  fillSortKeysFromPrevious(nextPlan, captured.queryPlan, previous);
  if (previous.metadata.filterPasses) visible.push(previous);
}
visible.sort(
  (left, right) =>
    compareRecordRows(nextPlan, left, right) ||
    compareOrderStatisticTreeIds(left.rowId, right.rowId),
);
// tree build: unchanged except the comparator plumbing from A2
const root = Object.freeze({
  revision,
  parentRevision: revision - 1,
  rows: captured.rows,          // identity — the entire point
  sourceOrder: captured.sourceOrder,
  visible: Object.freeze({ rows: tree }),
  queryPlan: nextPlan,
  expansion: captured.expansion,
  cause: Object.freeze({ kind: "set-query" as const }),
});
```

- Diagnostics: add `work.sortKeyCarries` / `work.sortKeyEvaluations` (mirror existing counter wiring exactly); `fillSortKeysFromPrevious` bumps them when instrumentation is present (thread it or count in the rebuild loop — pick what fits; counts must distinguish carry vs accessor).

- [ ] **Step 3: Green: fast-path tests, then FULL package suite**

Expect fallout in tests that asserted metadata sortKeys content — each edit individually justified in the report (same discipline as cycle-1 Task 5).

- [ ] **Step 4: Mutation-harden**

(a) Make `fillSortKeysFromPrevious` skip the store write → fail-loud comparator test must fail. (b) Make sort-rebuild rebuild records (`{...previous}` copies) → identity test must fail. (c) Break the carry (always run accessor) → counter test must fail. Report each.

- [ ] **Step 5: Commit**

```bash
git add -A packages/row-model
git commit -m "feat(row-model): sort-only changes carry records and the rows map by identity"
```

---

### Task A4: Phase-A measurement gate (Node)

No repo changes. Re-run the scratchpad `sort-decomposition.mjs` (it imports from this worktree's src via tsx) at 50k and 3k, 5 repeats. Record in `<scratchpad>/phase-a-node-results.md`. Expectation from the profile: 50k drops from ~250ms toward ~75-110ms (sort ~35ms + tree ~39ms + key fill + iteration; GC share should collapse with allocations). If 50k is NOT under ~140ms, STOP — report before Phase B (the ceiling analysis was wrong somewhere, and B's payoff math changes).

---

## Phase B — reorder signal and permutation layout

### Task B1: Journal reset reason `"reorder"`

**Files:**
- Modify: `packages/row-model/src/types.ts` (~:294 reason union), `change-journal.ts`, `create-local-row-model.ts` (fast-path publish), `sort-rebuild` publish call site if the reason flows through `publishCommittedRoot`
- Test: the journal's existing test file (find it: grep `appendBarrier` in `__tests__`) + `sort-fast-path.test.ts`

- [ ] **Step 1: Failing tests**

1. Journal-level: `appendBarrier(prev, rev, "reorder")` then `changesSince(prev, rev)` → `{kind: "reset", reason: "reorder", ...}` (whatever shape reset carries today — read it first).
2. **Mixed-range conservatism:** reorder barrier + a changes entry in range → reason is NOT "reorder" (falls back to the standard barrier/reset behavior — read what a barrier-in-range returns today, likely `"bulk-replace"`, and pin that). Two reorder barriers in range → still "reorder". Reorder barrier + non-reorder barrier → NOT "reorder".
3. Model-level: sort-only fast `setQuery` → `model.changesSince(prevRevision)` reports reset reason "reorder"; a filter `setQuery` (cooperative) still reports the pre-existing reason; `setRows` after a fast sort → mixed → NOT "reorder".

- [ ] **Step 2: Implement**

- `types.ts`: reason union gains `"reorder"`.
- `change-journal.ts`: barrier entries already carry a reason — `changesSince` must aggregate: when the range contains barriers, the returned reset reason is `"reorder"` iff EVERY entry in range is a barrier with reason "reorder"; otherwise today's behavior. Read `changesSince`'s current barrier handling (~:292) before writing.
- Fast path publish: `publishCommittedRoot` gains a reason parameter? NO — keep the shared recipe intact: the fast path is the only reorder producer; pass the reason through `publishCommittedRoot(committedRoot, previousRevision, revision, reason = "bulk-replace")` defaulting to today's value so `runTransitionSlice` is unchanged... READ what reason `appendBarrier` currently defaults to and preserve it for every existing caller; only the sort-only fast path passes "reorder".

- [ ] **Step 3: Green + full row-model suite + commit**

```bash
git add -A packages/row-model
git commit -m "feat(row-model): sort-only commits publish a reorder reset reason"
```

---

### Task B2: Public-surface + consumer audit

**Files:** possibly `packages/core/*.api.md` (regenerated, committed), `packages/grid-core/src/create-grid-ui-core.ts` (audit; change only if it would MISPARSE), apps/website docs guards.

- [ ] **Step 1:** `pnpm build && pnpm api` (order matters). `core.api.md` will change (reason union). Commit the regenerated report(s). If anything BEYOND the reason union changed, stop and investigate (leak).
- [ ] **Step 2:** Audit `grid-core/create-grid-ui-core.ts`'s `changesSince` handling: confirm it treats ANY `kind: "reset"` as full-resync regardless of reason (fail-closed). Add a test pinning that a "reorder" reset is handled as reset (not dropped/misparsed) IF no such test exists. Do not add reorder-awareness to grid-core in this project.
- [ ] **Step 3:** Run the website test suite (docs guards pin api.md-derived union tables — memory: guards fail closed). If a docs table lists the reset reasons union, update the table per the guard's instructions (the guard's failure message documents the registration flow). Run `pnpm test` repo-wide.
- [ ] **Step 4:** Commit.

```bash
git add -A
git commit -m "chore(core,docs): reorder reset reason through the public surface and guards"
```

---

### Task B3: `RowHeightIndex.reorder()`

**Files:**
- Modify: `packages/layout-core/src/row-height-index.ts`
- Test: layout-core's height-index test file (find it)

- [ ] **Step 1: Failing tests**

1. **Equivalence oracle:** build an index with N measured rows (mixed measured/estimated entries — read how tests build one today), permute the order, call `reorder({rowCount, entryAt})`; assert the rank→offset table (every rank's offset + total height) equals a full `replace()` over the same order. Include: reversal, single swap, identity permutation.
2. **Reuse counters:** entries reused === N; entries re-measured === 0 (add counters mirroring layout-core's existing instrumentation pattern — find how `beginReplacement` counts and mirror).
3. **Missing key throws:** a key in the new order absent from existing entries → throws (typed error per the file's error conventions).
4. **Row-count mismatch throws** (fewer/more rows than entries — the reorder contract says the SET is unchanged).
5. Post-reorder mutations work: a subsequent measurement update / replacement behaves normally.

- [ ] **Step 2: Implement**

Synchronous method on the index (same class/immutability discipline as `replace` — read whether `replace` returns a new index; `reorder` must match): walk the new order, look up each existing entry by key, rebuild the ordered structure + prefix sums in one pass (reuse the bulk machinery `replace` uses under the hood where it fits — the deferred-measure tree pattern exists in this codebase family; read what `row-height-index` uses internally before choosing). Constraint comment: why synchronous (order-only, heights known, ~10-20ms at 50k measured need).

- [ ] **Step 3: Mutation-harden** (skip a prefix-sum recompute → oracle fails; fabricate a missing-key entry instead of throwing → test 3 fails). Green, commit.

```bash
git add packages/layout-core
git commit -m "feat(layout-core): synchronous reorder over existing height entries"
```

---

### Task B4: Controller permutation path

**Files:**
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`
- Test: renderer-dom's controller test file (find how it mocks model + journal today; follow those harnesses)

- [ ] **Step 1: Failing tests**

1. A model publishing a reset with reason "reorder" (mock `changesSince`) → controller does NOT `startReplacement` (assert via its observable: replacementStartCount or the published state sequence) and publishes a ready root whose rank→offset table matches a full replacement oracle.
2. Anchor semantics: same scroll-anchor observable as `startReplacement` produces for the same scenario (read the existing anchor tests and mirror the strongest one).
3. Fallbacks, each one a test: reason ≠ reorder → replacement; `reorder()` throws (inject via a key mismatch) → replacement, no error published to the consumer beyond what replacement produces; revision mismatch → replacement.
4. Counters: reorder path taken count; fallback count (wire into the controller's existing diagnostics pattern if one exists; else layout-core's counters suffice — decide from the code and say which in the report).

- [ ] **Step 2: Implement**

In `synchronize` (~:1517), before the `validateChanges` branch: if the sequence is `{kind:"reset", reason:"reorder"}` AND revisions line up (`fromRevision === state.observedRevision`, `toRevision === target.revision` — read reset's actual field names), take the permutation path: capture anchor → `state.rowHeights.reorder(...)` with the same `{rowCount, entryAt}` source shape `startReplacement` builds (share that source-construction code — extract it if needed) → restore anchor semantics identically to the replacement path → `publishReady`. Wrap in try/catch → `startReplacement(target, true)` on ANY throw.

- [ ] **Step 3: Green (renderer-dom suite), mutation-harden the fallback (break the revision check → fallback test fails), commit.**

```bash
git add packages/renderer-dom
git commit -m "feat(renderer-dom): sort-only commits permute row heights instead of re-ingesting"
```

---

### Task B5: End-to-end verification

1. Full repo: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm api` (react-suite flake rule applies: re-run once).
2. Browser A/B per the one-variable protocol (same method as the cycle-1 Task 7 run, recorded in `<scratchpad>/sort-fast-path-perf-results.md`): merge-base vs branch, both scales, pretable+tanstack, repeats 3; plus filter-metadata collateral check; plus the grouped gate.
3. Work-based assertions from the bench trace: one PLAYWRIGHT_PERF_TRACE run at 50k; confirm via `analyze-cdp.mjs --window=interaction` that the post-publish re-ingest slices are GONE (no layout-core ingest frames in the window) and the interaction window shrinks accordingly.
4. Write `<scratchpad>/cycle-2-results.md` with all four success-criteria verdicts. STOP after recording — the merge decision returns to the user with these numbers (the PR is being held; do not open or merge it inside this task).

---

## Self-review notes (applied)

- Spec coverage: store+comparator → A1; reroutes → A2; shape removal + v2 + deletion + counters → A3; Node gate → A4; journal → B1; public surface + fail-closed audits → B2; layout reorder → B3; controller → B4; final gate → B5. Reserve lever and out-of-scope items have no tasks by design.
- Names used consistently: `compareRecordRows`, `fillSortKeysFromPrevious`, `work.sortKeyCarries`, `work.sortKeyEvaluations`, reset reason `"reorder"`, `RowHeightIndex.reorder`. (A1's "working name" labels mean the implementer may improve a name ONLY by reporting it; all later tasks then follow the reported name.)
- Known looseness, deliberate: exact fixture syntax and internal helper shapes are verified against reality at implementation time (this repo's pattern; assertions are the contract). Two decision points are delegated with explicit stop conditions: A4's ceiling check and B2's leak check.
