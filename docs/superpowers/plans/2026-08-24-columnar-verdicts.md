# Columnar Verdict Cache Implementation Plan (Amendment J)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-row verdict pass in the filter fast path with compiled predicates scanning slot-indexed value vectors, per Amendment J (`docs/superpowers/specs/2026-08-24-dense-handle-amendment-j-columnar-verdicts.md` — read it first; its five design deltas are binding).

**Architecture:** All inside `packages/row-model`. `CompiledRowInput` gains `slot`; the plan's shared evaluation cache gains a per-filter-column `SlotVector<unknown>` written wherever metadata is evaluated (the freshness invariant), adopted by reference across filter-only changes; `compileFilterPredicate` hoists operator dispatch out of the row loop; `filter-rebuild` consumes a bulk verdict scan. Per-row `filterVerdict` keeps its exact semantics for k-sized/grouped paths.

**Worktree:** `/Users/blove/repos/pretable/.claude/worktrees/homepage-hero-demo-3878ef`, branch `blove/filter-fast-path`. Test filter: `pnpm --filter @pretable-internal/row-model test` (557 green).

**Verified anchors** (re-verify; lines drift): `compiled-query.ts` — `CompiledRowInput` ~80; `CachedEvaluation` + cache comment ~262-300; constructor/active-columns ~1440-1470; `evaluate` ~1471 (collects `values` Map over `#active`, calls `#filterVerdict((id) => values.get(id))`); `#filterVerdict` ~1623 (the one predicate loop, `evaluateFilter(filter, #byId.get(...), valueOf(...))`); static `filterVerdict` ~1650 (memo guard then live accessor reads); `adoptEvaluationCache` static ~1900-1930 (`nextPlan.#evaluationCache = previousPlan.#evaluationCache`); `evaluateFilter` + `FILTER_OPERATORS` (search; operand validation at ~735-800 shows the operator/type space: number/date/text/enum/boolean, between/dateBetween ranges, string ops). `filter-rebuild.ts` — the `forEachSlotEntry` walk calling `filterVerdict(nextPlan, previous as never)` per row. Callers of `evaluate`: `row-store.ts` (buildRowStore, rebuildRowStoreForQuery — the latter is DEAD code, do not thread it), `transaction-draft.ts` `createRecord` (~290) and its callers, `cooperative-transition.ts`. Callers of `filterVerdict`: `filter-rebuild.ts`, `transaction-draft.ts` (`passesNext` memo), possibly `distinct-values.ts`/`group-index.ts` — grep and list them in your report.

**Bars:** Amendment J §Bars. Grouped and k-sized paths byte-identical in behavior; zero public API drift (`pnpm api` in the final task must show NOTHING — `CompiledRowInput` is internal; if it turns out to be re-exported through a governed barrel, STOP and report).

---

### Task 1: `CompiledRowInput.slot` + threading

**Files:** `compiled-query.ts` (the input type), `row-store.ts`, `transaction-draft.ts`, `cooperative-transition.ts`, `filter-rebuild.ts`, `sort-rebuild.ts`, plus every other `evaluate`/`filterVerdict`/`sortKeysOf`/`fillSortKeysFromPrevious` call site the compiler finds.

- Add `readonly slot: number` to `CompiledRowInput` (REQUIRED — the compiler enumerates the call sites; every caller has the record or just allocated the slot). Records passed `as never` (whole-record inputs) already carry `.slot`, so most sites compile untouched — verify which literal-input sites need an explicit `slot`.
- No behavior change; the field is unread this task. Tests: full suite green with zero existing-test edits (except fixtures that build `CompiledRowInput` literals — sanctioned, list them). Commit: `feat(row-model): thread slots into compiled-query inputs`.

### Task 2: compiled predicates

**Files:** `compiled-query.ts` (+ its test file)

- `compileFilterPredicate(filter, column): (value: unknown) => boolean` — one specialized closure per runtime filter, built at plan construction (`#compiledPredicates: readonly ((value: unknown) => boolean)[]` parallel to `#runtimeQuery.filters`), hoisting operand normalization out of the loop. It must reproduce `evaluateFilter`'s semantics EXACTLY — implement it by refactoring `evaluateFilter` into "compile" + "apply" so the semantics exist once (the current `evaluateFilter(filter, column, value)` becomes `compileFilterPredicate(filter, column)(value)` internally, or delegates — no duplicated predicate logic).
- `#filterVerdict` switches to the compiled array (same `every` shape, no `#byId` get per row).
- Tests: an exhaustive operator-semantics equivalence sweep — for every (column type, operator) pair in `FILTER_OPERATORS` with representative + edge values (empty string, NaN-adjacent, null/undefined cells, between bounds inclusive/exclusive as today), assert compiled predicate ≡ the pre-refactor behavior (pin against expected outcomes, not against the refactored code). Red-first for the new API; full suite green. Commit: `perf(row-model): compile filter predicates once per plan`.

### Task 3: columnar value store + freshness writes

**Files:** `compiled-query.ts` (+ tests)

- The shared-cache object (whatever `adoptEvaluationCache` moves — currently the `#evaluationCache` WeakMap reference) grows a sibling `#columnarValues: Map<string, {vector: SlotVector<unknown>}>` for FILTER columns, adopted in the same static call. Because plans currently share the WeakMap by direct field assignment, decide the container: wrap both in one `#sharedEvaluationState` object so adoption stays ONE assignment — refactor `adoptEvaluationCache` accordingly (its doc comment updates).
- **REVISED per Amendment J §3 (rev. 2026-08-24)**: `evaluate` NEVER writes cells (two ingest paths hand it a `-1` placeholder slot, and aborted drafts must not leave cell writes). The bulk scan (Task 4) is the only writer. THIS task implements the store plus the commit-side CLEARS: in `applyFlatTransactionDraft`'s success path (beside the `slotWrites` block), clear the cells of every prepared and removed row's slot on the current plan's shared state; `replaceFlatRowsDraft` and the initial build start from empty vectors (fresh shared state or a wholesale reset — pick the shape that matches how shared state is created there and document it). The Task-1 review's placeholder-site table (`d64fba85` review) is the authority on which slots are real. The vectors are COW (`slotVectorWithAll`) — but per-row writes during an O(n) ingest would copy chunks per row; use the transient pattern instead: accumulate writes per evaluation BURST... simpler and correct: `evaluate` calls land during bulk builds and k-sized updates alike, so give the store an explicit mutable-fill discipline mirroring the codebase's transient/freeze idiom: cells are written into a MUTABLE chunk representation owned by the shared state (plans on the same shared state never race — the model is single-threaded and the store is not revision-scoped; it is a CACHE, not a source of truth — old snapshots never read it). Document exactly that: the columnar store is cache-not-truth, mutable-in-place, keyed by (columnId, slot), correct because of the freshness invariant, and NEVER consulted by snapshot reads. This avoids COW entirely — record the deviation from the plan-of-record wording (Amendment J §2 says chunked COW; in-place-mutable-cache is simpler and sound because nothing revision-scoped reads it; note it in the amendment via a one-line edit in this task's commit).
- Slot-capacity growth: vectors grow like the allocator (chunk table extension on demand).
- Tests: freshness invariant oracle — a scripted model (ingest → filter commit → update changed values → remove+add reusing a slot → filter commit → a transaction whose accessor THROWS mid-draft (aborted) → filter commit) asserting the columnar answer equals a fresh accessor read for EVERY (filter column, live slot) after every step. Mutation (perform, restore, report): skip the commit-side clear for prepared rows → the update step's oracle fails. Commit: `feat(row-model): columnar filter-value cache with write-through freshness`.

### Task 4: bulk verdict scan + filter-rebuild consumption

**Files:** `compiled-query.ts`, `filter-rebuild.ts` (+ tests)

- New internal `bulkFilterVerdicts(plan, recordsBySlot, slotCapacity): MembershipBitset` — per filter: loop live slots (holes-aware walk over `recordsBySlot`), read the cell (hole → live accessor read + write-through fill), apply the compiled predicate, AND across filters into the bitset (first filter sets, subsequent filters clear — or evaluate all filters per slot in one pass; CHOOSE the one-pass-per-slot shape so a row's cells are read with locality and the fallback fill happens at most once per row, and document the choice).
- `filter-rebuild.ts`: the walk keeps its shape but the per-row `filterVerdict` call is replaced by a bitset lookup from ONE `bulkFilterVerdicts` call before the walk (or fold the flip-diff into the scan loop — keep the existing walk + `testMembershipBit(nextVisibleSlots, slot)` reads; simplest coherent shape wins, document it). Zero-flip identity carry, merge, `derivedById`, instrumentation counters all unchanged; add a `columnarVerdictScans` work counter.
- Per-row `filterVerdict` (static) is UNTOUCHED for k-sized/grouped callers.
- Tests: the columnar-vs-per-row equivalence oracle on randomized query scripts (reuse the Task 3 fixture style; include newly-referenced columns mid-script to exercise the hole-fill path); all existing filter fast-path pins (order-independence, zero record rebuilds, `filterRowsFlipped` counts) must pass UNCHANGED. Mutation: make the scan skip the hole-fill fallback → the newly-referenced-column script step fails. Commit: `perf(row-model): filter rebuild verdicts from columnar scan`.

### Task 5: gates + measurement

- `pnpm build && pnpm api` — expect ZERO `.api.md` drift (all internal). Full root `pnpm test` (react flake rule). Lint, prettier.
- Bench per the established protocol (M1+M2 plan Task 8 verbatim; scales `target` + `hypothesis`; baseline = the commit before this plan's Task 1; TanStack controls in band; interleaved paired sides; no grep|head; traced share run AFTER headlines for the verdict-share ≲3% bar).
- Deliverable: `docs/superpowers/specs/2026-08-24-columnar-verdicts-results.md` — table, deltas vs 108.3/116.8, both bar verdicts, fitness, conclusion (including what remains: rebuild-body ~17%, HAMT ~9%, render/commit ~23%). Commit.
