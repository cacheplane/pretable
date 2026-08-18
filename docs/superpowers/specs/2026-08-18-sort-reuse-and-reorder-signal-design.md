# Sort-key ownership + reorder signal: end-to-end sort latency

**Issue:** [#457](https://github.com/cacheplane/pretable/issues/457) — second cycle.
**Builds on:** `docs/superpowers/specs/2026-08-17-sort-fast-path-design.md` (cycle 1,
implemented on this branch: classifier, synchronous rebuild, setQuery wiring).

**Date:** 2026-08-18

## Problem

Cycle 1 made the 50k S2 sort complete and settle (`completed ×3`, settle
16–25ms, previously never) but landed at ~390–409ms interaction latency vs
TanStack's ~37ms — ~9.5x against a ~2x bar. Two profiles attribute the
residual precisely:

- **Node CPU profile** (`sort-residual-profile.md`): of ~250ms per 50k
  setQuery, ordering work (Array.sort + comparator) is only ~35ms — already
  TanStack-parity. ~86% is rebuilding immutable per-row state a sort does not
  logically change: new metadata + frozen records (~46ms carryover + freeze),
  a full new rows HAMT (~30ms + GC share), the visible tree (~39ms),
  sourceOrder traversal (~22ms), ~12% GC.
- **Browser trace** (`sort-browser-attribution.md`, interaction window):
  192ms synchronous setQuery task + **~215ms of layout-core row-height-index
  re-ingest** of all 50k rows (identity hash + HAMT insert + frozen rowRef
  per row, in 8ms cooperative slices) before the first changed frame
  presents. React render/commit is 5.3ms — innocent. The re-ingest happens
  because every query commit publishes a change-journal **barrier**, and the
  row-layout controller answers any barrier with a full replacement.

Two independent ~200ms levers. Both are in scope.

## Success criteria

Measured in-browser (`bench:matrix`), one variable, dist rebuilt per side:

1. S2 sort, target scale (50k): `completed ×3`, `interaction_latency_ms`
   within **~2x of same-run TanStack**.
2. S2 sort, hypothesis scale (3k): at or below the current 50–59ms band.
3. Grouped gate (`rebuild_slice_max_ms`, updates-grouped) green.
4. Work-based assertions (these hold even if the wall-clock bar wiggles):
   a sort-only change preserves the rows-map root by identity, and the
   layout controller's reorder path reports **zero** rows re-measured and
   zero identity re-ingests.

**Reserve lever** (named, not implemented): if measurements land at the top
of the ceiling range, replace the post-sort AVL visible tree with a flat
O(n) order container (~35ms floor). Only reached for if bars 1–3 miss.

## Decisions

- End-to-end bar; whole stack in scope (row model + journal + layout-core +
  renderer-dom).
- One spec, two phases: **A** (row model) then **B** (renderer). A is
  independently measurable in Node before B starts.
- The held PR accumulates these commits; nothing merges until the whole bar
  is evaluated.
- `resortRecordMetadata` (cycle 1) is **deleted**, tests included — the
  sort-key store replaces carryover. One mechanism, no deprecation aliases
  (pre-1.0, no external consumers).

## Workstream A — sort keys move from records to the plan

### Ownership

`CompiledRowMetadata` loses `sortKeys`. The aggregate leaf `dependency`
shrinks to `{ sourceOrder }`. Each `CompiledQueryPlan` owns a **sort-key
store**: `WeakMap<row object, readonly CompiledSortKey[]>`.

- **Eager fill:** `evaluate` writes the row's keys into the store at the
  point it computes them today — same work, different home. (Rows are
  replaced by object identity on update, so the WeakMap invalidates
  naturally; a stale-keys-after-update bug is structurally impossible.)
- **Swap fill:** on a sort-only plan change, the new plan's store is filled
  once per row during the rebuild pass — value carried from the OLD plan's
  store where the column sets overlap, accessor run only for newly-active
  sort columns (same carry rule as cycle 1, relocated).
- **Resolution rule:** all internal consumers obtain keys via the plan, never
  from metadata. A missing store entry on a live row is a defect, not a
  lazy-fill opportunity — resolution throws in that case (fail loud; the
  fill points above are exhaustive).

### Consumer reroutes (the complete list — audited 2026-08-18)

1. `compareRows` (compiled-query.ts): reads the plan's own store. Signature
   consequence: it can no longer compare bare metadata from two different
   plans; its inputs become row records (or rowId+row), and the tree
   comparator in `visible-index.ts` adapts.
2. `transaction-draft.ts:348` — the moved-row check (`sameKeyValues` on old
   vs new metadata sortKeys) resolves old keys from the OLD plan's store and
   new keys from the current plan's store.
3. `group-index.ts:897-921` — aggregate-leaf ordering reads dependency
   sortKeys today; reroutes to plan resolution.
4. `persistent/aggregate-tree.ts:480` — dependency identity check. With
   sortKeys gone from the dependency, a sort-only change leaves every
   dependency identical, so aggregate subtrees **reuse instead of rebuild**
   — a correctness-preserving improvement (aggregation is order-independent;
   the invariant tests below pin it).

No consumer outside `packages/row-model` reads `sortKeys` or `dependency`
(grep-audited; grid-core/renderer-dom matches are unrelated prose).

### sort-rebuild v2

On a sort-only change (same classifier gate as cycle 1):

- **No record rebuild. No rows transient. No metadata construction.** The
  new root's `rows` IS the captured root's `rows` (identity). Records,
  `publicRow`, `integrity`, metadata all carry.
- Fill the new plan's store (carry-or-accessor, once per row, during the
  same pass that collects filter-passing records).
- `Array.sort` the record refs with the new plan's comparator; bulk-build
  the visible tree (`createOrderStatisticTreeFromSortedEntries`, unchanged).
- Publish through `publishCommittedRoot` as today, except the journal entry
  (workstream B).

Error semantics unchanged from cycle 1 (accessor failure → same error
status shape; state untouched on throw).

## Workstream B — order-only journal signal + permutation layout path

### Journal

New entry kind `reorder`: `{ kind: "reorder", fromRevision, toRevision }`,
asserting the visible row SET and every row identity/height-relevant fact
is unchanged — only order. Published by the sort-only fast path instead of
`appendBarrier`. Every other commit path is untouched (barriers remain
barriers).

`changesSince` surfaces reorder entries to consumers. Consumers that do not
understand them treat them exactly like barriers (fail-closed: the sequence
validator in any consumer that predates the kind must classify unknown
kinds as "cannot enumerate" — verify this is already true of the row-layout
controller's `validateChanges` and any other journal consumer; if a
consumer would misparse rather than reject, that is a blocking finding).

### Layout-core

`RowHeightIndex` gains `reorder(source)` (same `{rowCount, entryAt}` source
shape as `beginReplacement`): rebuilds the ordered structure **from existing
measurement entries by key** — no re-measure, no identity re-hash for keys
already known, recomputed prefix sums only. Synchronous (the whole point;
~10–20ms at 50k). A key present in the new order but missing from the
existing entries (should be impossible under the reorder contract) throws —
the controller catches and falls back to full replacement.

### Row-layout controller

In `synchronize`, when `changesSince(observedRevision)` yields a sequence
that is exclusively reorder entries (plus the revision bookkeeping),
take the permutation path instead of `startReplacement`:

- `rowHeights.reorder(...)` with the new snapshot's order.
- Anchor/scroll restoration IDENTICAL in semantics to `startReplacement`'s
  (capture anchor, restore against the new order) — a sort change today
  re-anchors; the permutation path must not change that UX.
- `publishReady` with the rebuilt root.
- ANY doubt — mixed sequence, validation failure, reorder() throw,
  revision gap — falls back to `startReplacement`. Conservative default,
  same philosophy as the cycle-1 classifier.

### Identity dependency between A and B

The controller's `entryAt` keys rows via `rowRef(target.rowAt(index))`.
Workstream A preserves `publicRow` identity across a sort-only change,
which is what makes "existing entry by key" lookups exact. B therefore
lands after A and its tests assert the identity chain explicitly.

## Instrumentation

- Row-model: `synchronousRebuilds`/`synchronousRebuildMs` keep their
  meaning; add `work.sortKeyCarries` / `work.sortKeyEvaluations` (carry vs
  accessor counts — the swap-fill efficiency is observable).
- Layout-core/renderer: reorder-path counters — entries reused, entries
  re-measured (expected 0), reorder fallbacks (expected 0 on the happy
  path; a nonzero fallback count in the bench is a finding).

## Testing

TDD throughout; mutation-hardened per house standard (every new assertion
demonstrated to fail under a seeded defect before it ships).

**Workstream A:**
1. The stale-hazard test (the trap that made cycle 1 rebuild records): a
   `setRows` update AFTER a sort-only fast path re-ranks the updated row
   correctly, and a non-key update does NOT move it (moved-row check
   resolves through the store, both plans' stores agree where they must).
2. Cold-model equivalence extended beyond cycle 1's: visible order,
   aggregates (grouped and ungrouped), group ordering, distinct values —
   after sort-only change vs fresh model, AND after sort-only change
   followed by mutations.
3. Identity: rows-map root `toBe` across sort-only change; every
   `publicRow` `toBe`; selection-bearing consumers unaffected (row-model
   level: record identity is the proxy).
4. Aggregate-reuse improvement pinned: dependency identity stable across
   sort-only change (and the aggregate values still correct — assert the
   positive twin, not just the reuse).
5. Grouped path still correct with rerouted key resolution (grouped sort
   equivalence vs cold model — grouped does NOT take the fast path but DOES
   use the rerouted consumers).
6. Delete `resortRecordMetadata` + its describe block; cycle-1 fast-path
   tests updated to the new invariants (identity assertions replace
   metadata-content assertions where metadata no longer changes).

**Workstream B:**
7. Journal: sort-only commit emits `reorder`, not a barrier; every other
   commit kind unchanged; an unknown-kind consumer rejects (fail-closed
   check).
8. Layout: `reorder()` produces a rank→offset table identical to a full
   replacement over the same order (equivalence oracle); reuse counter =
   row count, re-measure counter = 0; missing-key throw → controller
   fallback engages (fault-injection test).
9. Controller: permutation path preserves anchor semantics (same
   scroll-restoration observable as `startReplacement` for the same
   scenario); mixed/invalid sequences fall back.
10. e2e (website or bench-level): sorted 50k grid's first changed frame no
    longer waits for ingest — assert via the bench's frames-to-first-change
    or the reorder counters, not wall-clock alone.

**Final gate:** browser A/B per the one-variable protocol (merge-base vs
branch, rebuild between sides, same-run TanStack), all four success
criteria evaluated, numbers recorded before any merge decision.

## Out of scope

- Publish-early/refine-later layout (would help filter latency; separate
  issue if pursued).
- Filter-change fast path (unchanged from cycle 1's deferral).
- The flat O(n) order container (reserve lever; only on a missed bar).
- Progress publishes (still deferred).
