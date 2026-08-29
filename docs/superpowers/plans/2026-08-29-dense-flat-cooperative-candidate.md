# Dense flat cooperative candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flat (ungrouped) cooperative transition candidate array/slot-resident — identity-carry for flat set-query, transient map for the evaluate lane — targeting 50k flat filter total ≤120 ms with zero blocking preserved (issue #490).

**Architecture:** Extract the flat lane into `flat-cooperative-candidate.ts` behind the existing grouped predicate (Task 1, faithful port), then replace its internals: identity-carry build sweep over the captured slot vector with upgrade-to-mutable on the first mid-flight delta (Task 2), and the transient-map evaluate lane for `set-derivations` / grouped→flat (Task 3). One-row-per-`step()` and every existing transition pin stay intact.

**Tech Stack:** TypeScript, Vitest, Playwright bench harness.

**Spec:** `docs/superpowers/specs/2026-08-29-dense-flat-cooperative-candidate-design.md` — READ IT FIRST, including the lane-eligibility amendment. The internals it relies on are quoted with line refs below (taken at `1e3b9305`; re-locate by content).

**Repo rules that bite:** rebuild deps before app tests; never pipe gate output through `grep|head`; `lsof -i :4173` before benching (never kill a holder); react vitest randomly times out 1–2 unrelated tests under load (re-run once); commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` on every commit.

---

### Task 1: Faithful flat extraction (pure refactor — behavior byte-equivalent)

**Files:**
- Create: `packages/row-model/src/flat-cooperative-candidate.ts`
- Modify: `packages/row-model/src/cooperative-transition.ts` (constructor dispatch; flat-only branches removed from the shared loop)
- Test: existing suite is the oracle; add one dispatch pin in `packages/row-model/src/__tests__/transitions.test.ts`

- [ ] **Step 1: Read the current flat lane end-to-end** — `cooperative-transition.ts` `createCooperativeTransitionCandidate` (:335–810): construction (:359–456), `insertRecord`/`removeRecord` (:553–610), `append` (:635–648), `step()` (:649–719), `finish` (:720–763), `release` (:765–780), diagnostics registration (:781–808). Identify every branch the FLAT path takes (grouped fields undefined; `state.rows.set` at :588; flat visible insert at :595–599; `finish`'s flat arms at :732–736/:754–757).

- [ ] **Step 2: Write the failing dispatch pin** in `transitions.test.ts` (near the top-level describe): a flat set-query transition's candidate diagnostics (via the file's existing diagnostics accessor — see how `work.test.ts` reads candidate diagnostics) reports `hasGroups: false` AND a new marker distinguishing the flat module. Give `flat-cooperative-candidate.ts` the same `CooperativeTransitionCandidateDiagnostics` registration with `hasGroups: false`, `overrideReconciliationRemaining: 0`. If the diagnostics shape has no distinguishing field, pin instead that a grouped transition and a flat transition BOTH still work (construct one of each, settle, assert results) — the refactor's oracle is then the full suite; the pin documents the seam. Run: expected FAIL only if you added a marker; otherwise skip to Step 3.

- [ ] **Step 3: Extract.** New module exports:

```ts
export function createFlatCooperativeCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  options: CreateCooperativeTransitionCandidateOptions<TRow, TRowId, TColumns>,
): CooperativeTransitionCandidate<TRow, TRowId, TColumns> { ... }
```

Port the flat behavior VERBATIM in this task (yes, including the per-row `state.rows.set` HAMT write and per-row `evaluate` — Task 2 replaces them; this task only moves code): construction seeds (`initialRows` from captured, fresh `createFlatVisibleTree(queryPlan)`, `recordsBySlot: []` mutable array, `slotCapacity` from `options.captured.slotCapacity`, `sourceOrder` by identity, `iterator = captured.sourceOrder.entries()`, `deltas: []`), `insertRecord`/`removeRecord` minus every grouped branch, `append` with the `* 2 + 1` unit accounting + `Math.max` capacity widening, `step()` phases build → replay (no seal, no override reconciliation — flat completes when deltas drain), `finish` (flat arms only: `visible = Object.freeze({rows: state.flatRows})`, slot sweep + `slotVectorFromEntries`, `membershipFromFlatTree`), `release` (truncate + null out), `options = undefined as never` retention cut, diagnostics WeakMap registration with the same shape. In `cooperative-transition.ts`'s `createCooperativeTransitionCandidate`, add at the top:

```ts
  if (options.queryPlan.query.rowGroups.length === 0) {
    return createFlatCooperativeCandidate(options);
  }
```

and DELETE the now-dead flat branches from the shared loop (the `state.groups === undefined && state.groupBuilder === undefined` paths) so the shared file serves only the two grouped lanes. Export any helpers both modules need (`orderedRowEntry` already has its own module; move/share `CooperativeTransitionDelta`, options type, diagnostics registration helper as needed — keep one definition, no copies).

- [ ] **Step 4: Verify byte-equivalence** — `pnpm --filter @pretable-internal/row-model test 2>&1 | tail -4` (expect the full suite green, ~660+); `pnpm --filter @pretable-internal/row-model build 2>&1 | tail -2`; lint + prettier. Then downstream: `pnpm --filter @pretable/react test > /tmp/flat-extract-react.log 2>&1; echo exit: $?; tail -3 /tmp/flat-extract-react.log`.

- [ ] **Step 5: Commit** — `refactor(row-model): extract the flat cooperative candidate into its own module (#490)`.

### Task 2: Identity-carry set-query lane + upgrade-on-append

**Files:**
- Modify: `packages/row-model/src/flat-cooperative-candidate.ts`
- Test: `packages/row-model/src/__tests__/flat-cooperative-candidate.test.ts` (new), `packages/row-model/src/__tests__/work.test.ts`

- [ ] **Step 1: Failing tests first.** In the new test file (reuse `transitions.test.ts`'s fixtures/helpers idioms — manual scheduler, `flushAll`, model factory):

```ts
describe("flat cooperative candidate — identity carry", () => {
  test.each([
    ["filter-only", COLD_FILTER_QUERY],
    ["sort-only", COLD_SORT_QUERY],
    ["combined", COLD_COMBINED_QUERY],
  ])("a delta-free flat set-query (%s) settles equal to a cold model", async (_label, nextQuery) => {
    const { model, scheduler } = createFlatModelAboveGate(); // rows > filter gate limit OR inject ɵfilterFastPathRowLimit: 0 so set-query goes cooperative on a small fixture
    const transition = model.setQuery(nextQuery);
    scheduler.flushAll();
    await transition.finished;
    const cold = createLocalRowModel({ rows: FIXTURE_ROWS, columns, query: nextQuery, getRowId });
    expect(snapshotIds(model)).toEqual(snapshotIds(cold));
    expect(visibleSlotBits(model)).toEqual(visibleSlotBits(cold)); // via the equivalence helper visible-slots.test.ts uses
  });

  test("a delta-free flat set-query carries rows and recordsBySlot by identity", async () => {
    const before = internalsOf(model).root; // use getLocalRowModelSlotInternalsForTesting or the file's root accessor
    const transition = model.setQuery(NARROWING_QUERY);
    scheduler.flushAll();
    await transition.finished;
    const after = internalsOf(model).root;
    expect(Object.is(after.rows, before.rows)).toBe(true);
    expect(Object.is(after.recordsBySlot, before.recordsBySlot)).toBe(true);
    // survivor tree entries are the captured records by identity:
    expect(Object.is(firstVisibleRecord(after), before.rows.get(firstVisibleId))).toBe(true);
  });

  test("a mid-flight transaction upgrades the candidate and the settled root reflects it", async () => {
    const transition = model.setQuery(NARROWING_QUERY);
    scheduler.flush(SOME_UNITS); // partial build
    model.applyTransaction({ update: [...], remove: [...], insert: [...] }); // routes through appendTransitionDelta
    scheduler.flushAll();
    await transition.finished;
    const cold = coldModelAtFinalState();
    expect(snapshotIds(model)).toEqual(snapshotIds(cold));
    // upgraded root must NOT be identity-carried:
    expect(Object.is(internalsOf(model).root.rows, capturedRowsBefore)).toBe(false);
  });

  test("grouped→flat set-query does NOT identity-carry (evaluate lane)", async () => {
    // model starts GROUPED; setQuery to a flat query; settled records' metadata
    // must be the FLAT evaluation (groupPath []), asserted via the oracle +
    // a groupPath probe on a settled record.
  });
});
```

In `work.test.ts`, the dense pin:

```ts
test("a flat set-query transition copies zero HAMT nodes and evaluates zero rows", async () => {
  // mirror the grouped 10k case at :140; assert
  // work.hamtNodesCopied === 0 (for the transition window), work.rowsEvaluated === 0,
  // work.transitionRows === ROW_COUNT — and the NEGATIVE control from :291 still detects a full rebuild.
});
```

Adapt names to the real helpers (read `work.test.ts:140–200` and `visible-slots.test.ts` first). Run — expected: identity/work pins FAIL against the Task 1 port (it still evaluates + sets).

- [ ] **Step 2: Implement the identity-carry lane** in `flat-cooperative-candidate.ts`:
  - Lane predicate at construction: `identityCarry = options.operation === "set-query" && options.captured.queryPlan.query.rowGroups.length === 0` (next plan is already known flat).
  - `adoptEvaluationCache(options.queryPlan, options.captured.queryPlan)` at construction (both lanes; it is a cache handoff, not a correctness dependency).
  - Build sweep: replace the `sourceOrder.entries()` iterator + `captured.rows.get` with a slot cursor over `captured.recordsBySlot` (`forEachSlotEntry` is not resumable — keep a plain `{chunkIndex, offset}` cursor or a simple ascending slot index with hole-skips; ONE ROW PER STEP as today). Per record: NO `evaluate`, NO allocation — `if (filterVerdict(queryPlan, record)) { flatRows = flatRows.insertOrReplace(orderedRowEntry(queryPlan, record)); setMembershipBit(bits, record.slot); }` where `bits = createMembership(slotCapacity)` from construction. Comment at the carry site: why metadata cannot change (groupPath [] both sides; aggregateLeaves consumed only by the group index — pointer to `group-index.ts` consumer), per the spec.
  - `totalRows` still seeds from `captured.rows.size`; `completedRows += 1` per swept row (holes don't count — verify `rows.size === populated slots`; they are 1:1 on a committed root). `instrumentation.work.transitionRows += 1` per swept row; do NOT increment `rowsEvaluated` (document at the counter).
  - **Upgrade-on-append**: first `append(delta)` while in identity mode converts: `transientRows = capturedRows.asTransient()` (verify TransientMap supports get/set/delete — `persistent/transient.ts`), `mutableRecordsBySlot = copy of the carried vector into a plain array`, `slotByRowId = new Map()` filled lazily or upfront from the mutable array. Replay phase then runs today's remove-then-insert against those; replayed inserts carry the delta target's record by identity in this lane, re-`filterVerdict`ed under the candidate plan, bits updated (`clearMembershipBit`/set — check the bitset module for a clear helper; if none, add one with a test).
  - `finish` (delta-free): carry `rows` + `recordsBySlot` + `slotCapacity` by identity; `visibleSlots` = the swept bitset (same object shape `filter-rebuild.ts` publishes); `visible = Object.freeze({rows: flatRows})`; NO `membershipFromFlatTree`, NO slot sweep. `finish` (upgraded): freeze the transient, `slotVectorFromEntries` from the mutable array, bitset as maintained.
  - Keep `release()`'s retention discipline for both modes.

- [ ] **Step 3: Run tests** — new file + `work.test.ts` + FULL row-model suite green; the equivalence matrix passes for all three set-query shapes with and without deltas.

- [ ] **Step 4: Mutation self-checks before handoff** (report each): (a) reintroduce `Object.freeze({...record})` in the carry → identity pins fail; (b) skip `setMembershipBit` for one row → visibleSlots equivalence fails; (c) leave `rows` identity-carried after an upgrade → the mid-flight test fails; (d) drop `adoptEvaluationCache` → everything still passes (it must be a pure perf lever). Revert all.

- [ ] **Step 5: Commit** — `feat(row-model): identity-carry flat set-query transitions (#490)`.

### Task 3: Evaluate/transient lane (`set-derivations`, grouped→flat)

**Files:**
- Modify: `packages/row-model/src/flat-cooperative-candidate.ts`
- Test: `packages/row-model/src/__tests__/flat-cooperative-candidate.test.ts`, `packages/row-model/src/__tests__/work.test.ts`

- [ ] **Step 1: Failing tests.** Equivalence oracle rows for: flat `set-derivations` (with a derivation change that visibly alters an aggregate-dependent read — pick whatever `distinct-values`/derivations tests use to observe derivations) with and without a mid-flight delta; grouped→flat set-query (already stubbed in Task 2 — now assert its work profile). `work.test.ts` pin: a 10k flat set-derivations transition has `hamtNodesCopied` ≈ O(1) (transient freeze, not per-row path copies — mirror the grouped assertion `< 10_000`... assert a TIGHT bound, e.g. `< 100`, and prove it can fail by reverting to the persistent set).

- [ ] **Step 2: Implement.** Non-identity lane: per-row `evaluate` + `Object.freeze({...source, metadata})` as today, but `rows` built via `initialRows.asTransient()` from construction, `.set` per row (O(1)), frozen once when the build phase drains (the grouped path freezes at seal — flat freezes at iterator exhaustion, BEFORE replay; replay in this lane reuses the same transient-until-finish machinery as the upgraded identity lane — unify them: the evaluate lane simply starts already "upgraded"). `recordsBySlot` written per row into the mutable array; `finish` as the upgraded path. Membership bits set for passing rows during the sweep (delete `membershipFromFlatTree` from this lane too).

- [ ] **Step 3: Full row-model suite + react suite green; lint/prettier/build.**

- [ ] **Step 4: Commit** — `feat(row-model): transient evaluate lane for flat derivations transitions (#490)`.

### Task 4: Verification, traced re-measure, bench certification (controller runs this)

- [ ] `pnpm build && pnpm api` (build FIRST; expect no public report drift) + root lint + full test.
- [ ] Traced 50k filter-metadata run (`PLAYWRIGHT_PERF_TRACE=1`, `--window=settle`, with sourcemap): HAMT + evaluate shares must have collapsed; record the before/after share table.
- [ ] Bench rounds, medians of 3, pretable + tanstack: 3k (all four scripts — unchanged within a frame) and 50k (sort / filter-metadata / filter-text / filter-keystrokes). Bars: filter total ≤120 (fallback ≤150 documented), keystroke warm p50 ≤130, zero long tasks everywhere, cooperative sort not regressed, controls in band. Also one `replace` + one `append` run at 50k (delta machinery sanity) and the grouped scripts at hypothesis (untouched-lane control).
- [ ] Two rounds if any cell disagrees; revert discipline on a flat result.

### Task 5: Results doc + PR

- [ ] `docs/superpowers/specs/2026-08-29-dense-flat-cooperative-candidate-results.md`: trace share table, bench tables, bar verdicts, fitness statement (load, controls), M2 decision (skipped/needed with numbers).
- [ ] Push, PR `feat(row-model): dense flat cooperative candidate (closes #490)`, auto-merge, verify merged via `gh pr view` before recording anywhere.
