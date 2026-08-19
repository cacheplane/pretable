# Decorated Entries + Bulk Mount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #457's last two failing verdicts — the grouped-gate regression (per-comparison WeakMap resolution) and the sort-during-mount race (450ms blank cooperative mount) — via decorated tree entries, a synchronous bulk mount path, and reorder composition into active replacements.

**Architecture:** C1 (row-model): tree entries across the flat visible tree, grouped leaf trees, and aggregate trees carry `{record|leaf, keys}`; comparators become `compareWithSortKeys` property reads. C2a (layout-core + renderer-dom): when the base `RowHeightIndex` holds no retained state, a replacement builds synchronously in O(n); the controller runs it to completion in one pass. C2b (renderer-dom): `captureActiveTarget` accepts a reorder reset as a final retarget; `finishReplacement` composes it via `candidate.reorder()`.

**Spec:** `docs/superpowers/specs/2026-08-18-decorated-entries-and-bulk-mount-design.md`. Grounding documents (read the ones your task cites): the lifecycle map (in the C-cycle coordination context), `<scratchpad>/grouped-gate-regression-findings.md`, `<scratchpad>/grouped-rebuild-timing.mjs`, `<scratchpad>/cycle-2-results.md`.

**Conventions:** as cycles 1–2 (TDD, mutation-hardening, constraints-only comments, prettier/lint/typecheck per commit, never touch ~/repos/pretable, verify HEAD before amends).

---

### Task C1: Decorated tree entries (grouped + flat)

**Files:**
- Modify: `packages/row-model/src/visible-index.ts`, `group-index.ts`, `cooperative-transition.ts`, `transaction-draft.ts`, `sort-rebuild.ts`, `create-local-row-model.ts` (recompile-path reseed), possibly `persistent/aggregate-tree.ts` (leaf shape) and `internal-types.ts`
- Test: existing suites are the oracle; timing recorded via `grouped-rebuild-timing.mjs`

The change: everywhere a persistent tree currently stores a bare record (flat visible tree, grouped leaf trees) or a bare aggregate leaf, store the entry WITH its resolved keys, and compare via `compareWithSortKeys(plan, l.record, l.keys, r.record, r.keys)`. One shape convention across all three trees. Key resolution happens exactly once per insert (`sortKeysOf`, or keys the caller already holds — sort-rebuild's decorated pairs flow through).

Method:
- [ ] **Step 1:** Map every tree construction + insert + entry-read site (grep `createFlatVisibleTree`, `insertOrReplace`, `entryAt`, `range(`, leaf-tree builders in group-index, aggregate-tree leaf construction). Write the inventory into your working notes; the A2 audit lists the comparator sites.
- [ ] **Step 2:** Introduce the decorated entry type (e.g. `OrderedRowEntry<...> = { record, keys }`) and change `createFlatVisibleTree` to store it: `getId: (entry) => entry.record.rowId`, `compare: (l, r) => compareWithSortKeys(plan, l.record, l.keys, r.record, r.keys)`. Adapt every consumer read (`entry.rowId` → `entry.record.rowId` etc.) and every insert site to construct `{record, keys: sortKeysOf(plan, record)}` (or pass held keys). Run the package suite after EACH file's adaptation.
- [ ] **Step 3:** Same for grouped leaf trees and `compareAggregateLeaves`' tree (group-index.ts; the aggregate-tree leaf gains keys per the minimal-ripple encoding you choose — document the choice).
- [ ] **Step 4:** `sort-rebuild.ts`: its `{record, keys}` pairs now feed `createOrderStatisticTreeFromSortedEntries` DIRECTLY (the tree's entry type matches) — delete the map-back-to-records step. The bulk constructor's verification comparator now reads entry keys (no store gets).
- [ ] **Step 5:** Full package suite green (baseline 412; equivalence oracles: the A2 grouped pin test, A3 grouped/aggregate tests, cycle-1 fast-path tests). Root build + typecheck (layout/renderer untouched by C1 but the barrel types ripple — verify).
- [ ] **Step 6:** Timing: `pnpm build`, then run `grouped-rebuild-timing.mjs` per its header (3 passes, pre-change HEAD vs your working tree, interleaved, quiet machine). Target: slice-work total recovered to ~pre-A2 (~1870ms band in that harness). Record numbers in `<scratchpad>/c1-grouped-timing.md`. If NOT recovered, STOP and report with the numbers.
- [ ] **Step 7:** Mutation-harden: (a) make one insert site store stale/wrong keys → an equivalence test must fail (if none does, the fixtures can't disprove decoration — fix the fixture); (b) revert one comparator to compareRecordRows → timing regresses (recorded, not unit-asserted). Prettier/lint. Commit:
```bash
git add -A packages/row-model && git commit -m "perf(row-model): tree entries carry their sort keys"
```

---

### Task C2a: Synchronous bulk replacement when nothing is retained

**Files:**
- Modify: `packages/layout-core/src/row-height-index.ts`, `packages/renderer-dom/src/row-layout-controller.ts`
- Test: both packages' suites

Layout-core:
- [ ] **Step 1 (TDD):** tests first — `hasRetainedState` predicate (false on a fresh/empty index; true with ≥1 measurement, ≥1 tombstone, or retained entries — read what state categories exist: `#measurements`, `#tombstones`, `#tombstoneOrder`); bulk path equivalence oracle: for a no-retained-state base, the new synchronous path over `{rowCount, entryAt}` equals the cooperative builder's result at EVERY rank (offsets, heights, total) for sizes {0, 1, 32, 1000}; post-bulk mutations (measure, replace, reorder) behave identically to a cooperatively-built twin; the predicate DISABLES the path (a base with one measurement uses the cooperative builder — assert via whatever distinguishes them: diagnostics counters or builder-phase observables).
- [ ] **Step 2:** Implement. Recommended shape (adapt to the class): inside `beginReplacement`, when `!this.hasRetainedState`, return a builder whose first `advance()` completes everything via `buildBalancedSequence` + bulk identity-map construction (values = measured ?? source estimatedHeight ?? defaultHeight — read RHI:1906-1926's exact height rule and reproduce it; at true mount all three collapse to defaultHeight but the rule must match for the equivalence oracle). This keeps the controller's builder contract untouched. Constraint comment: why synchronous (spec C2a; ~20ms at 50k measured in B3).
- [ ] **Step 3:** Controller: in `startReplacement`, extend the eager gate: `if (state.observedRevision === null || !state.rowHeights.hasRetainedState)` → `runReplacementSlice(replacement, /*ignoreDeadline*/ true)` (read the existing eager gate at ~:1412-1419 first — the bulk builder makes ignoreDeadline complete in ONE unit, so this is cheap; keep `eagerInitialRowLimit` working as-is for its documented purpose). Verify: a 50k mount publishes during `activateController`'s synchronize pass — no scheduler entries (controller test, TDD).
- [ ] **Step 4:** Mutations: (a) predicate always-true → the retained-state test fails (a measured base must NOT take the bulk path); (b) bulk path skips the height rule (always defaultHeight) → equivalence oracle with source estimates fails. Suites green (layout-core 109+, renderer-dom 137+), repo typecheck. Commit:
```bash
git add packages/layout-core packages/renderer-dom && git commit -m "perf(layout-core,renderer-dom): replacements over unmeasured state build synchronously"
```

---

### Task C2b: Compose a reorder into an active replacement

**Files:**
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`
- Test: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts` (B4's harness)

- [ ] **Step 1 (TDD, red first):**
  1. Reorder reset arriving mid-replacement (drive a real cooperative replacement — a base with retained measurements so C2a doesn't bulk it — then a real sort-only setQuery): NO restart (`replacementStartCount` unchanged), `reorderComposeCount` +1, final published order equals a from-scratch oracle, staged measurements taken during the replacement survive into the final index.
  2. Reorder then CHANGES before finish → fail-closed restart (`reorderComposeFallbackCount` +1 or restart counter — pick the observable and be consistent).
  3. Reorder then newer reorder → last wins (final order = second sort's).
  4. Compose-time `reorder()` throw (lie about the row set) → restart fallback, no error publish.
  5. Anchor: the composed finish restores the anchor against the FINAL order with replacement semantics (mirror B4's anchor test through the compose path).
- [ ] **Step 2:** Implement per spec C2b: `captureActiveTarget` accepts `{kind:"reset", reason:"reorder", toRevision === targetRevision}` as a retarget — set `replacement.pendingReorder = target` (the snapshot), advance `capturedRevision = toRevision`, swap `latestTarget`, republish rebuilding status (mirror the changes-retarget branch); if `pendingReorder` is ALREADY set and the wake is anything but a newer aligned reorder → return false (restart). Read the finish gate (RLC:994-1002) — `pendingReorder` must NOT block the gate; in `finishReplacement`, after staged replay, `if pendingReorder: candidate = candidate.reorder(replacementSourceOf(latestTarget))` inside the existing try so throws hit the restart fallback. Counters on the B4 seam.
  - CAREFUL: after accepting a reorder, `appliedRevision`/catch-up contiguity — the pending queue's changesets end at the pre-reorder revision; the finish gate compares `appliedRevision === capturedRevision`, which the reorder advanced. Reconcile deliberately (e.g. `pendingReorder` records `{target, fromApplied: previousCapturedRevision}` and the gate treats `appliedRevision === fromApplied && pendingReorder` as satisfied) — read the gate and pick the minimal coherent rule; document it in a constraint comment.
- [ ] **Step 3:** Mutations: (i) skip the compose (publish without reorder) → order oracle fails; (ii) accept changes after pendingReorder → test 2 fails; (iii) drop the throw fallback → test 4 fails. Suites green; repo typecheck; prettier. Commit:
```bash
git add packages/renderer-dom && git commit -m "feat(renderer-dom): reorders compose into active replacements at finish"
```

---

### Task C3: End-to-end re-verification (the four bars)

Same protocol as cycle-2 B5 (see `cycle-2-results.md` for method), no commits:
- [ ] Grouped gate ×3 quiet runs: ≤8ms, near 7.7.
- [ ] Browser bench: 50k + 3k sort, pretable+tanstack, repeats 3; filter-metadata collateral; mount metrics if the bench reports time-to-first-window (check `bench-runtime.ts` for a mount/first-paint metric; else use one PLAYWRIGHT_PERF_TRACE mount trace to read first-publish timing).
- [ ] One 50k sort trace: interaction window attribution; `reorderFallbackCount === 0` and compose/reorder counters engaged (temporary instrumentation acceptable, reverted after, as B5 did).
- [ ] Full repo gates: typecheck, lint, test, api (build first).
- [ ] Write `<scratchpad>/cycle-3-results.md` with all four verdicts; STOP — the merge decision goes to Brian with the numbers.

---

## Self-review notes (applied)

- Spec coverage: C1 → Task C1; C2a → Task C2a; C2b → Task C2b; bars → C3. Out-of-scope items have no tasks.
- The one deliberate implementation freedom: C1's aggregate-leaf keys encoding and C2a's builder-vs-method shape are implementer choices bounded by the spec's contracts; both must be reported.
- Sequencing enforced: C1 unblocks the gate before C2 touches the renderer; C3 evaluates everything together.
