# Dense-Identity Layout Seam Implementation Plan (Amendment I)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `RowHeightIndex` a dense lane keyed by row-model slots so a 50k refilter performs zero per-survivor string work, and feed it through the renderer-dom controller from new `ɵ`-internal row-model snapshot reads — attacking the ~33% layout share of the remaining filter-settle window.

**Architecture:** Per Amendment I (`docs/superpowers/specs/2026-08-24-dense-handle-amendment-i-layout-seam.md` — read it first). Dense mode is a PER-GENERATION, all-or-nothing property of the index: a generation whose every entry carries a `denseKey` maintains a visible-slots bitset instead of the `visibleKeys` HAMT and runs slot-indexed refilter/reorder; any input that cannot supply dense keys drops the whole index back to the string lane via the controller's existing full-replacement fallback. Measurements and tombstones stay string-identity-keyed in BOTH lanes (slot reuse must never touch retention — the amendment's §3 trap).

**Tech Stack:** TypeScript; vitest (`pnpm --filter @pretable-internal/layout-core test`, `pnpm --filter @pretable-internal/row-model test`, renderer-dom + react suites — check each package.json for exact names); bench harness per M1+M2 Task 8.

**Worktree:** `/Users/blove/repos/pretable/.claude/worktrees/homepage-hero-demo-3878ef`, branch `blove/filter-fast-path`.

**Verified code anchors** (re-verify line numbers before editing; they drift):
- `packages/layout-core/src/row-height-index.ts`: `refilter` at ~1582; `apply` at ~1326; `retainMeasurement` at ~1273; `reorder` ends ~1563; replacement builder class begins ~1841 (`#visibleKeys` at 1841, ingest hashSet at ~2161); `#next(...)` generation constructor ~1804; `HeightValue` carries `ref/identity/estimatedHeight/height/measured`.
- `packages/layout-core/src/types.ts`: `RowHeightReplacementSource` (~line 259 area), operation types.
- `packages/renderer-dom/src/row-layout-controller.ts`: `rowRef` 297 (allocates a frozen ref PER CALL), `identityOf` 305, `replacementSourceOf` 1444 (per-row `rowAt` = O(log n) rank descent each), apply-ops construction ~831/~877, refilter/reorder dispatch ~1794–1855 (fallback-on-throw contract lives here).
- `packages/row-model/src/create-local-row-model.ts`: `createSnapshot` 86 (wraps `createFlatSnapshot(root)`; instrumented variant spreads and re-wraps reads — new reads must be added to BOTH). The snapshot's flat implementation is in `visible-index.ts` or adjacent (find `createFlatSnapshot`).
- Row-model facts: `RevisionRoot` has `recordsBySlot`, `visibleSlots`, `slotCapacity`; records carry `.slot`; `ɵ` prefix is the repo's internal-export convention (see `ɵfilterAuthority`).

**Bars (from Amendment I):** untraced 50k filter settle ≤ ~95ms; refilterFallbackCount 0 on the happy path; 3k no regression; TanStack controls in band; every `.api.md` line of drift reviewed and intended; docs api-surface guard green (update registered tables in the same commit if it fires).

---

### Task 1: layout-core dense primitives + type surface

**Files:**
- Create: `packages/layout-core/src/dense-membership.ts`
- Modify: `packages/layout-core/src/types.ts`
- Test: `packages/layout-core/src/__tests__/dense-membership.test.ts`

- [ ] **Step 1: Failing test for the bitset** — mirror row-model's `membership-bitset.test.ts` behaviors (set/clear/test across word boundaries; out-of-range reads false; clone-with-growth). layout-core cannot import row-model, so this is a deliberate ~40-line duplicate; the module header must say so and name the original.
- [ ] **Step 2:** Red run: `pnpm --filter @pretable-internal/layout-core test -- dense-membership` (verify the package's real name first).
- [ ] **Step 3:** Implement `dense-membership.ts` (same function shapes as row-model's `membership-bitset.ts`: `createDenseMembership(capacity)`, `setDenseBit`, `clearDenseBit`, `testDenseBit`, `cloneDenseMembership`). Header comment: duplicated from `@pretable-internal/row-model` `membership-bitset.ts` by design — layout-core stays dependency-free; keep the two in sync by hand.
- [ ] **Step 4:** Green run.
- [ ] **Step 5: Types.** In `types.ts`: `RowHeightReplacementSource` gains `readonly denseCapacity?: number`, and its `entryAt` row shape gains `readonly denseKey?: number`. Every `RowHeightOperation` variant's ref-bearing shape gains `readonly denseKey?: number`. Doc comments state the contract from Amendment I §1: dense keys are OPTIONAL; a generation is dense only when EVERY entry carries one and `denseCapacity` is present; a dense key is the row's CURRENT model slot, valid only while the model binds that slot (the caller owns that currency); mixed input falls back to the string lane wholesale.
- [ ] **Step 6:** Typecheck + lint the package; commit:

```bash
git add packages/layout-core/src/dense-membership.ts packages/layout-core/src/types.ts packages/layout-core/src/__tests__/dense-membership.test.ts
git commit -m "feat(layout-core): dense-membership primitive and dense-key type surface"
```

---

### Task 2: dense generations in `RowHeightIndex` — state, builder ingest, guards

**Files:**
- Modify: `packages/layout-core/src/row-height-index.ts`
- Test: `packages/layout-core/src/__tests__/row-height-index.test.ts` (extend)

**Design (decision-complete):**
- `HeightValue<TKey>` gains `readonly denseKey: number | undefined` — stamped at every ingest site from the input's `denseKey`.
- The index gains two generation fields threaded through `#next` and the builder: `#denseCapacity: number | undefined` and `#visibleSlots: DenseMembership | undefined`. INVARIANT (comment it at the field): `#visibleSlots !== undefined` ⇔ this generation is dense ⇔ every sequence entry has a `denseKey` < `#denseCapacity`. A dense generation does NOT maintain `#visibleKeys` (it stays `null`); a string generation never allocates `#visibleSlots`.
- The replacement BUILDER decides the lane at `begin`: source has `denseCapacity` AND every ingested entry carries `denseKey` → dense (build the bitset as it ingests, skip `hashSet(visibleKeys, ...)` entirely); the first entry missing a `denseKey` when `denseCapacity` was declared → throw `RowHeightReplacementLifecycleError` (the controller's existing catch → full string replacement... no: throw would loop). Instead: missing `denseKey` with declared capacity is a CALLER BUG — throw; the controller only declares `denseCapacity` when the snapshot guarantees slots (Task 4 makes that guarantee). No capacity declared → string lane, exactly today's code.
- Guards on a dense index: `apply` insert dup-check and `retainMeasurement`'s visible-check use `testDenseBit(#visibleSlots, op.denseKey)`. An op WITHOUT `denseKey` reaching a dense index throws `RowHeightReplacementLifecycleError` with a message naming the contract ("dense index requires dense-keyed operations; fall back to a full replacement") — the dispatch sites in the controller already treat throws as fallback (verify: the ~1794–1855 block and the apply call site; if apply throws are NOT already routed to fallback, Task 5 wires that).
- `apply` insert/remove maintain `#visibleSlots` (set/clear by denseKey) in dense mode, `#visibleKeys` in string mode — never both.
- Measurements/tombstones: UNTOUCHED in both lanes (string identity). `measure()` keeps working by identity on both lanes.

- [ ] **Step 1: Failing tests first** (extend the existing suite in its own describe): (a) a dense-built index answers `apply` insert-dup and `retainMeasurement` guards correctly (both accept/reject cases); (b) an op without `denseKey` on a dense index throws the lifecycle error; (c) a string-built index is bit-for-bit unaffected (run a representative existing scenario through both construction styles and compare observables); (d) dense builder with a missing entry denseKey under declared capacity throws.
- [ ] **Step 2:** Red run. **Step 3:** Implement. **Step 4:** Green run + full layout-core suite (133+ tests) — string-lane tests must pass UNCHANGED (zero expectation edits; if one needs editing, stop: the lane leaked).
- [ ] **Step 5:** Commit `feat(layout-core): dense generations — builder ingest, bitset membership, guarded ops`.

---

### Task 3: dense `refilter` and `reorder`

**Files:**
- Modify: `packages/layout-core/src/row-height-index.ts` (refilter ~1582, reorder ending ~1563)
- Test: `packages/layout-core/src/__tests__/row-height-index.test.ts` (extend)

**Design (decision-complete) — dense refilter:**
- Old pass (in-order walk, unchanged shape): additionally build `unconsumedBySlot: (HeightValue<TKey> | undefined)[]` sized `#denseCapacity` (one allocation per refilter; 50k pointers ≈ 400KB transient — fine) instead of the string `unconsumed` Map. `previousValues` stays.
- New-order walk, per row: `denseKey` REQUIRED (absent → throw lifecycle error → controller fallback); dup-check via a local `seen` DenseMembership; `nextVisibleSlots` bit set per row; survivor = `unconsumedBySlot[denseKey]` — reuse verbatim, clear the array cell, NO identity string computed. Entrant: compute `identity` NOW (only entrants pay the string), then the existing measured/tombstone lookups verbatim; stamp `denseKey` on the new HeightValue.
- Leavers: cells still set in `unconsumedBySlot` — walk it (or keep a parallel count/list; simplest: iterate the array once, `for (let s = 0; s < capacity; s++)`) and run the existing retire logic (identity is already ON the HeightValue). ORDER CAUTION: today's leaver pass follows the OLD-SEQUENCE order via the Map's insertion order, and tombstone tickets are assigned in that order (comment at ~1668 says so, and ticket order is observable via cap eviction). A slot-index walk breaks that order. Preserve it: iterate `previousValues` in order and retire those whose `unconsumedBySlot[value.denseKey]` cell is still occupied (then clear it). Pin this with a test: cap-limited tombstones + a narrowing refilter → eviction order identical between lanes.
- `unchanged` detection, work counters, and every observable stay as today.
- **Dense reorder:** same substitution — the `unconsumed` Map in `reorder` becomes `unconsumedBySlot`; keys resolve by `denseKey`; missing key → lifecycle throw.
- refilter on a dense index yields a dense generation (`nextVisibleSlots` becomes its `#visibleSlots`); on a string index, today's code verbatim.

- [ ] **Step 1: Failing tests:** (a) **lane-equivalence oracle**: a randomized script (seeded PRNG, ~200 rows, 30 steps of narrowing/widening/reordering refilters + measures) run through a string-lane index and a dense-lane index in lockstep; after every step compare heights sequence, `totalHeight`, work-counter observables that are lane-independent (`refilterEntriesReused/Inserted/Retired`), tombstone count. (b) the ticket-order pin above. (c) **the Amendment §3 slot-reuse trap**: measure row X; refilter X out (X tombstoned, slot kept); simulate permanent removal + slot reuse by presenting a NEW identity Y with X's old denseKey in the next FULL replacement (dense builder), then refilter Y in and out: Y must ingest at estimate (never X's measurement), X's measurement must return only for X's identity. Mutation-harden: key the hot measurement path by denseKey on purpose (temporary) and watch (c) fail; restore.
- [ ] **Step 2:** Red. **Step 3:** Implement. **Step 4:** Green + full package suite, string tests untouched.
- [ ] **Step 5:** Commit `perf(layout-core): slot-indexed refilter and reorder for dense generations`.

---

### Task 4: row-model `ɵ` snapshot dense reads

**Files:**
- Modify: wherever `createFlatSnapshot` lives (find it: `grep -rn "createFlatSnapshot" packages/row-model/src`), `create-local-row-model.ts` (createSnapshot wrapper at 86 — add the new reads to the instrumented spread too), `packages/row-model/src/index.ts` if snapshot type is exported there
- Test: `packages/row-model/src/__tests__/` (extend an existing snapshot-adjacent suite or add one)

**Design:** the snapshot gains three `ɵ`-prefixed reads, documented as the renderer seam (flat roots only):
- `ɵvisibleSlotRange(start, end): readonly number[]` — slots of visible rows in order, from the tree's materialized `range` walk (entries carry `record.slot`). Grouped root → returns `undefined` (type: `readonly number[] | undefined`) — the caller must fall back.
- `ɵslotOfRowId(rowId): number | undefined` — one HAMT get (`root.rows.get`); for k-sized op stamping only (doc comment MUST say "k-sized paths only — never call per visible row").
- `ɵslotCapacity(): number | undefined` — `root.slotCapacity` for flat roots, `undefined` for grouped.
Wire the instrumented wrapper (createSnapshot at 86) to pass them through (count `snapshotOutputRowsRead` for the range read, mirroring `range`).

- [ ] Steps: failing test (flat: slots match `rowAt(i)`-resolved records' slots across a filter change; grouped: all three return undefined; `ɵslotOfRowId` on missing id → undefined) → red → implement → green (full row-model suite; expect NO existing-test edits) → commit `feat(row-model): internal dense snapshot reads for the renderer seam`.

---

### Task 5: renderer-dom controller — dense sources, ops stamping, bulk walk, pooled refs

**Files:**
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`
- Test: renderer-dom's controller suite (find it; 154 tests exist in the package)

**Design (decision-complete):**
- `replacementSourceOf` (1444): resolve `const slots = target.ɵvisibleSlotRange(0, target.visibleRowCount)` and `const capacity = target.ɵslotCapacity()` ONCE; when both defined, the source declares `denseCapacity: capacity` and `entryAt` returns `{ key, denseKey: slots[index] }`. ALSO replace the per-row `target.rowAt(index)` with a bulk `target.range(0, rowCount)` materialized ONCE per source construction (kills the O(n log n) rank descents) — entryAt indexes the array; keep the same omitted-row error on a hole. Grouped/undefined → today's shape verbatim (string lane).
- Apply-ops construction (~831/~877): stamp `denseKey: target.ɵslotOfRowId(row.rowId)` — when it returns undefined on a dense index the op will throw in layout-core and the dispatch's existing catch routes to full replacement; VERIFY the apply call site is inside the fallback-on-throw protection (the refilter dispatch at ~1794–1855 is; if the apply path isn't, wrap it to the same contract and count it in `refilterFallbackCount`-adjacent diagnostics — read how the controller currently handles apply throws first and match that convention).
- Pooled refs (spec M5's "rowRefs pooled by slot"): `rowRef` (297) allocates a frozen object per call. Add a slot-indexed pool (plain array on the controller instance, grown to capacity) so a data-row ref for slot s is created once and reused while the rowId matches (`pool[s]?.rowId === row.rowId ? pool[s] : (pool[s] = freeze({...}))`). Group refs unpooled. This is safe because refs are value-compared via `identityOf` everywhere (sameRef at ~317) — but VERIFY no consumer relies on ref allocation identity per call; grep the controller for `===` comparisons on refs before pooling; if any exist, report NEEDS_CONTEXT rather than guessing.
- `identityOf` calls on the n-sized paths should now be rare; do NOT micro-optimize further here.

- [ ] Steps: failing tests (dense source construction: a fake snapshot with slots → source entries carry denseKeys and bulk range is called once — spy/count; fallback: grouped snapshot → no denseCapacity; pooled refs: two source constructions reuse ref objects for unchanged rows — assert identity) → red → implement → green (renderer-dom suite + react suite `pnpm --filter @pretable/react test`) → commit `perf(renderer-dom): dense-keyed layout sources, bulk visible walk, slot-pooled refs`.

---

### Task 6: end-to-end pins + API surface + docs guard

**Files:**
- Modify: `.api.md` reports via `pnpm build && pnpm api`; docs tables ONLY if the guard fires
- Test: react integration suite; website suite if docs tables changed

- [ ] **Step 1:** An end-to-end react test (extend the existing filter fast-path integration suite in packages/react if one exists — find where `refilterPathCount` is asserted): drive a 200-row grid through filter-on → narrow → widen → filter-off; assert `refilterPathCount` advanced and `refilterFallbackCount === 0` (the dense path didn't silently fall back), and row heights survive (a measured row keeps its height across a flip-out/flip-in). Mutation: break denseKey stamping (stamp undefined) → the test must catch it via `refilterFallbackCount > 0` — this is the pin that keeps the dense lane from silently rotting back to fallback.
- [ ] **Step 2:** `pnpm build && pnpm api` — REVIEW the `.api.md` diff line by line: expected drift is layout-core types (`denseKey`/`denseCapacity`/HeightValue if exported) and row-model `ɵ` snapshot reads. Anything else → stop and fix. Commit the reports with the code that caused them if not already.
- [ ] **Step 3:** Full repo `pnpm test` (react flake rule applies) + `pnpm lint`. If the docs api-surface guard fails, update the registered tables per the guard's own error message in the same commit.
- [ ] **Step 4:** Commit `test(react): dense layout seam end-to-end pins` (+ api/docs updates).

---

### Task 7: measurement

Same protocol as M1+M2 Task 8 (`docs/superpowers/plans/2026-08-24-dense-handle-m1-m2.md` Task 8 — reuse verbatim: port check, load, interleaved paired sides, TanStack controls, medians of 3, no grep|head, no tracing for headlines). Baseline side = the commit before this plan's Task 1. Scales: `target` (50k) and `hypothesis` (3k — NOT `dev`, which is 750 rows; verified in the M1+M2 run). Scripts: filter-metadata, filter-text. Deliverable: `docs/superpowers/specs/2026-08-24-dense-layout-seam-results.md` with the table, deltas vs 116.8/125.6ms, the ≤~95ms bar verdict, fitness statement, and what remains (columnar cache next). Optionally one traced run AFTER the headline numbers for the share re-attribution (layout share ≤10% bar). Commit the doc.
