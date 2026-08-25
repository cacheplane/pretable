# Filter subset rebuild: settling filters at TanStack parity

**Follows:** the #457 arc (merged PR #479). This cycle applies the same
philosophy to filter-only changes. Baseline: `filter-baseline.md`
(scratchpad, 2026-08-19).

**Date:** 2026-08-19

## Problem

Filter interaction latency already beats TanStack (15–18ms vs 32–54ms at
50k, first changed frame in 1). The gap is the **settle tail**: ~240ms of
cooperative rebuild at 50k vs TanStack's ~58ms. Trace attribution: 76%
row-model — persistent-map rebuild 59ms, transition driver 37ms, predicate
re-evaluation 36ms, tree rebuild 26ms; renderer height re-ingest is only
13ms; paint negligible.

A filter-only change produces a **subset-or-superset of an already-sorted
set**: values, sort keys, group paths, and order are unchanged; only
membership verdicts change. Rebuilding every record and both persistent
structures is work the change does not logically require.

## Decisions (brainstorm, 2026-08-19)

- **Bar:** 50k S2 filter settle ≤ same-run TanStack settle (~58ms band).
- **Approach 1 adopted:** synchronous filter-delta subset rebuild — records
  rebuilt ONLY for verdict-flipped rows; merge-based visible tree; journal
  stays a barrier (renderer share too small to chase).
- **Approach 2 rejected:** moving `filterPasses` out of metadata ripples
  through `filteredLeaf`/aggregate machinery for savings Approach 1 already
  captures when flip counts are small.
- **Approach 3 named as the reserve lever:** per-filter verdict bitsets so
  an edit to one filter re-runs one predicate. Pulled only on a missed bar.

## Success criteria

1. 50k S2 filter-metadata AND filter-text: `completed ×3`,
   settle ≤ same-run TanStack settle (~15% tolerance for run noise).
2. Interaction latency stays in its current band (15–18ms) — the fast
   first frame must not regress.
3. No regressions: 3k bands, sort bands (15–17ms), grouped gate ≤ 8,
   mount, full repo suites, api reports unchanged.
4. Work-based assertions: on a filter-only change, unflipped rows' records
   carry by identity; the rows-map transient performs O(flipped) sets; the
   visible tree is built without a comparator sort (merge + bulk build —
   assert zero Array.sort of the full set, via instrumentation counters).

## Design

### Classifier

`isFilterOnlyChange(previous, next)` derived from the existing
`classifyQueryDelta`: filtersChanged AND nothing else changed (runtime
facets; authorities equal). Fast-path gate additionally requires ungrouped
(both plans) and operation `set-query`. Conservative as always: any doubt →
cooperative path.

### Synchronous subset rebuild (`filter-rebuild.ts`, sibling of sort-rebuild)

Per source-order row (all records, not just visible):

1. **Verdict:** run the NEW plan's filter predicates against stored values
   where retained, accessors where not. Note: predicate inputs are column
   VALUES — the sort-key store retains values only for sort columns; filter
   columns' values are not retained (cycle-1 finding). So predicates re-run
   with accessor reads per row — the measured ~36ms. (The reserve lever
   attacks this; not this phase.)
2. **Diff:** compare against `previous.metadata.filterPasses`.
   - Unflipped: record carries BY IDENTITY. No map write.
   - Flipped: new record via the existing `#finalizeMetadata`-equivalent
     path (new `filterPasses`, new `filteredLeaf` around the carried
     aggregate values; sort keys carried from the plan store — the new plan
     needs its store filled per row exactly as sort-rebuild does via
     `fillSortKeysFromPrevious`; a filter-only change carries ALL sort
     columns, so fills are 100% carries).
   - Rows map: ONE transient over the captured map, `set` only flipped
     rows.
3. **Visible tree by merge:** walk the OLD visible tree in order emitting
   still-passing entries (their decorated `{record, keys}` entries carry —
   flipped-out rows are skipped; flipped-in rows are NOT in the old tree);
   merge with the newly-passing rows sorted by their stored keys
   (`compareWithSortKeys` over the decorated pairs — sorting only the
   flipped-in set, k log k); the merged strictly-sorted array feeds
   `createOrderStatisticTreeFromSortedEntries`. Flipped-in entries must
   reference the NEW records (rebuilt in step 2); still-passing entries
   whose records carried MUST reference the carried records (entry reuse by
   identity where possible — a reused entry object is valid because record
   and keys are both unchanged).
4. **Publish:** `publishCommittedRoot` with the default barrier reason
   (NOT "reorder" — the row set changed). Error semantics identical to
   sort-rebuild (accessor/predicate failure → same error status shape,
   state untouched).

### The new plan's sort-key store

Filled per row during the same pass (all carries — assert via the existing
`sortKeyCarries` counter). This keeps the A-invariant: any tree bound to
the new plan resolves keys fail-loud-safely.

### Instrumentation

`work.filterRebuilds`, `work.filterRowsFlipped`, and reuse of
`synchronousRebuildMs` (or a sibling `filterRebuildMs` — implementer picks,
consistently). The zero-full-sort assertion rides the merge design: add
`work.filterMergeSortedInsertions` (= flipped-in count) so tests can pin
that only the flipped-in subset was sorted.

### Renderer

Untouched. The barrier-driven cooperative replacement remains; its 13ms
share is accepted. (The bulk path from C2a does NOT apply — the base has
retained measurements — and must not: assert the retained-state path still
runs, no behavior change.)

## Out of scope

- Per-filter verdict decomposition (reserve lever).
- `filterPasses` ownership move (rejected).
- Grouped filter changes (cooperative, as before).
- Any renderer/journal change.
- External filter authority: under `filterAuthority: "external"` the
  runtime filters are empty — a public filter change classifies as no
  runtime change (same containment as sort authority in cycle 1).

## Testing

House standard (TDD, mutation-hardened, positive/negative twins):

1. Classifier: table-driven, mirroring the sort classifier's suite.
2. Equivalence: fast-path result vs cold model — visible order, counts,
   aggregates, distinct values — across: narrowing, widening, disjoint
   flip (both directions at once), filter-to-empty, empty-to-filter,
   no-op verdict change (filter changed but zero rows flip: still a new
   revision, tree may carry wholesale — decide and pin).
3. Identity: unflipped records `toBe` across the change; rows-map root
   changes ONLY when flips exist; flipped records new with correct
   `filteredLeaf`.
4. The merge: fixture where flipped-in rows interleave arbitrarily with
   survivors (ties included — sourceOrder resolution); mutation: break the
   merge order → bulk constructor throws or equivalence fails.
5. Counters: flipped counts exact; merge-sorted-insertions == flipped-in;
   sortKeyCarries == rowCount, evaluations == 0.
6. Stale-hazard heir: `setRows` after a filter fast path re-evaluates
   correctly (the moved-row check and journal behavior unchanged).
7. Supersede/error paths: mirror the sort fast-path suite.
8. End-to-end: bench protocol, both filter scripts, both scales, plus the
   full no-regression sweep (sort, grouped gate, mount).
