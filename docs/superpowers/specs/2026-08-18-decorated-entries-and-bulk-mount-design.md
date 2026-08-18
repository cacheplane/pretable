# Decorated entries + bulk mount: closing the last two #457 verdicts

**Issue:** [#457](https://github.com/cacheplane/pretable/issues/457) — third cycle.
**Builds on:** cycles 1–2 on this branch (fast path, identity carry, reorder
signal, permutation layout path). Cycle-2 verdicts (`cycle-2-results.md`):
flat sort transformed (8.4ms when the reorder path engages) but bar 1 still
fails because the benched sort races the still-running mount ingest, and
bar 3 (grouped gate) regressed 7.7 → 8.2–9.2ms from per-comparison WeakMap
resolution on the grouped path.

**Date:** 2026-08-18

## Problem, precisely

1. **Grouped gate (C1):** A2 rerouted grouped comparators through
   `compareRecordRows`, which resolves both sides' sort keys from the plan's
   WeakMap **per comparison**. The grouped cooperative rebuild is incremental
   (`insert` per row per unit; no bulk sort to decorate), ~4M comparisons ×
   2 gets ≈ the measured +11% slice-work delta
   (`grouped-gate-regression-findings.md`). The flat visible tree pays the
   same tax on incremental inserts (ungated; filter-metadata at 58.3ms =
   top of band). The zero-allocation memoized-comparator treatment was
   implemented and measured **neutral** — the gets themselves are the cost.
2. **Sort-during-mount (C2):** at 50k the initial replacement ingests
   cooperatively for ~450ms during which **nothing paints** (`window: []`;
   the eager gate covers ≤32 rows), and a sort arriving mid-ingest
   fail-closes into a full re-ingest (the benched 342–350ms). The
   lifecycle map (exploration 2026-08-18) established: at initial mount
   there are no retained measurements, so the builder's 450ms produces an
   index whose every entry is `defaultHeight` — trivially computable; B3
   measured an O(n) balanced bulk build of 50k entries at 15–20ms. The
   builder cannot produce partial indexes (no root until its final phase),
   so partial/refinement publishing was rejected as the wrong tool
   (decision: rescope approved 2026-08-18).

## Success criteria

1. Grouped gate: `rebuild_slice_max_ms ≤ 8` across 3 quiet-machine runs,
   at or near the cycle-1 7.7ms.
2. 50k S2 sort (bench, same protocol as cycle 2): `completed ×3` AND
   `interaction_latency_ms` within ~2x same-run TanStack — now genuinely
   reachable: mount builds in ~20ms, so the benched sort hits the reorder
   path (measured 8.4ms when engaged).
3. Mount improvement (new, work-based): time-to-first-published-window at
   50k mount drops from ~450ms to <50ms (assert via bench mount metrics or
   the controller diagnostics; exact observable chosen at implementation).
4. No regressions: 3k band, filter-metadata band, full repo suites, api
   reports unchanged beyond intended.

## Workstream C1 — decorated entries (grouped + flat)

Tree entries carry their resolved sort keys; comparisons become property
reads. Zero WeakMap gets in any O(n log n) or per-insert comparison path.

- **Entry shape:** the flat visible tree, grouped leaf trees, and aggregate
  trees store `{ record, keys }` (aggregate leaves: `{ leaf, keys }` or keys
  alongside the existing leaf shape — implementer picks the minimal-ripple
  encoding per tree, one convention across all three).
- **Key source at insert:** the inserting code resolves once via
  `sortKeysOf(plan, record)` (one get per insert) or passes keys it already
  holds (sort-rebuild's decorated pairs feed the tree directly — unifying
  with the cycle-2 decorated sort).
- **Comparators:** `compareWithSortKeys(plan, l.record, l.keys, r.record,
r.keys)` everywhere a tree comparator runs. `compareRecordRows` remains
  for one-shot comparisons only.
- **Invariants preserved:** a tree is bound to one plan (the A2
  rebuild-or-reseed invariant); entry keys are valid for the tree's
  lifetime. Entry replacement on row update replaces the keys with it (the
  update path already re-evaluates the row under the current plan).
- **Ripple:** consumers that read tree entries (visible-index snapshot,
  group-index, cooperative-transition, transaction-draft, sort-rebuild)
  adapt from `entry` to `entry.record`. All internal to row-model.

## Workstream C2 — bulk mount + compose-at-finish

### C2a: synchronous bulk replacement when nothing is retained

- `RowHeightIndex` (layout-core) gains a cheap predicate (e.g.
  `hasRetainedState`: any measurements, tombstones, or retained entries) and
  a synchronous bulk path: when the base index has NO retained state, a
  replacement over `{rowCount, entryAt}` builds the balanced sequence +
  identity map in one O(n) pass (reuse B3's `buildBalancedSequence` +
  bulk-map machinery). Exposed as either a fast path inside
  `beginReplacement` (builder completes on first `advance`) or a distinct
  synchronous method — implementer picks what fits the class; the
  controller-visible contract is "initial mounts complete in one slice".
- Controller: `startReplacement` keeps its current shape; the eager gate
  (`eagerInitialRowLimit`) is superseded for the no-retained-state case —
  when the predicate holds, run the replacement to completion synchronously
  (same accepted synchronous-burst trade as cycles 1–2; the bench gate
  note already covers the philosophy). Retained-state replacements keep
  cooperative slicing unchanged.
- The blank-mount fix follows: first `publishReady` lands ~20ms after
  activation at 50k.

### C2b: compose a reorder into an active replacement at finish

- `captureActiveTarget`: a reset with reason `"reorder"` whose
  `toRevision` matches the incoming target revision is ACCEPTED as a
  retarget (today any reset → restart): swap `latestTarget`, advance
  `capturedRevision`, set a `pendingReorder` flag on the replacement. No
  builder restart.
- **Composition rule (conservative):** a reorder retarget is accepted only
  as the FINAL retarget — if any further wake arrives after
  `pendingReorder` is set (changes or another reset of any reason except a
  newer reorder, which simply replaces the flag's target), fail closed to
  restart. This avoids reasoning about index-based pending operations
  applied across a permutation. (A newer reorder replacing an older one is
  safe: reorders are wholesale.)
- `finishReplacement`: after catch-up drains and staged measurements
  replay, if `pendingReorder` is set, `candidate =
candidate.reorder(replacementSourceOf(latestTarget))` before publish.
  Any throw → the existing fallback (restart on latestTarget).
- Counters: extend the B4 diagnostics (`reorderComposeCount`,
  `reorderComposeFallbackCount`) on the existing seam.

## Out of scope

- Partial/refinement publishing (rejected for this problem; a future issue
  may revisit for filter-rebuild latency).
- Any scheduling/budget change (still refuted).
- The flat O(n) order container (reserve lever, still unpulled).

## Testing

House standard: TDD, mutation-hardened, positive/negative twins.

C1: grouped gate re-measured (3 quiet runs, the success bar); grouped +
flat equivalence suites stay green with entries decorated (the A2 pin test
and A3 grouped tests are the oracles); a Node grouped-rebuild timing
comparison (existing `grouped-rebuild-timing.mjs`) showing the slice-work
delta recovered to ~pre-A2 levels — recorded, not unit-asserted.

C2a: layout-core — bulk path equivalence oracle vs cooperative build over
identical sources (every rank), predicate tests (any retained measurement/
tombstone disables it), post-bulk mutations behave; controller — 50k-scale
mount publishes on the first synchronize pass (no scheduler entries),
existing replacement tests untouched for the retained-state path.

C2b: controller — reorder mid-replacement composes (no restart, counters),
final order equals a from-scratch oracle; reorder followed by changes →
fail-closed restart; reorder replacing reorder → last wins; staged
measurements survive composition; anchor semantics preserved.

End-to-end: the cycle-2 B5 protocol re-run (browser A/B, all four bars,
trace attribution confirming the measured sort takes the reorder or
compose path — `reorderFallbackCount === 0` in the benched runs).

## Sequencing

C1 first (unblocks the failing gate; independently verifiable in Node),
then C2a, then C2b, then the end-to-end re-verification. The PR stays held
until all bars are evaluated together.
