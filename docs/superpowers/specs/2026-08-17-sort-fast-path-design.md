# Sort fast path: query-delta classification + synchronous rebuild

**Issue:** [#457](https://github.com/cacheplane/pretable/issues/457) — S2 sort at target scale (50k rows) never settles: 515ms of transition work against a 400ms window. Related: [#452](https://github.com/cacheplane/pretable/issues/452) (~2x interaction gap at 3k).

**Date:** 2026-08-17

## Problem

A sort change runs the full cooperative transition: every row gets a fresh
`queryPlan.evaluate` (all active accessors, all filters, cold per-plan cache),
a record freeze, a HAMT insert, and an AVL insert — ~10µs/row, ~515ms at 50k
(`cooperative-transition.ts:556`, `compiled-query.ts:1373`). TanStack sorts the
same rows in ~33ms with `slice().sort()` over cached values.

Constraints established by prior measurement (issue #457 comment, full A/B):

- **Lever 1 (slice budget) is refuted in-browser.** The browser inverts the
  Node curve: larger budgets improved Node wall time ~2x and worsened
  `interaction_latency_ms` by 1–2 frames. No scheduling change ships.
- **The Node harness decomposes work; it does not predict browser latency.**
  Latency claims are made only from the browser bench.
- The fix must come from **work reduction**.

## Decisions (made during brainstorming)

- **Lever 4 (progress publishes) is deferred.** If work reduction lands, the
  frozen-surface window shrinks below the threshold where it matters. Revisit
  only if the measured result still breaches the settle window.
- **General delta classification, sort implemented first.** The classifier is
  built to describe any query change; only the sort-change fast path ships in
  this project. Filter-change reuse is a designed-for follow-up.
- **The fast path is fully synchronous.** It completes atomically inside
  `setQuery`: no candidate, no slices, no mid-transition delta replay.
  Accepted trade: no jank bound on pathological datasets (huge row counts or
  expensive custom comparators block the main thread for the duration).
- **Approach A — prior-metadata carryover.** Reuse is a one-shot transfer from
  the old root's records into the new ones. No long-lived cross-plan value
  cache, no invalidation surface.

## Scope

In scope:

1. A **query-delta classifier** in `packages/row-model`.
2. A **synchronous sort-change rebuild path** in `create-local-row-model.ts`,
   for **ungrouped** queries only.
3. Instrumentation and bench-gate accounting for the new path.

Out of scope (explicitly):

- Progress publishes / partial sorts (deferred, see above).
- Filter-change fast path (classifier supports describing it; implementation
  is a follow-up).
- Grouped queries (stay on the cooperative path; eligible for carryover in a
  later project).
- Any scheduling/budget change (refuted).

## Success criteria

Measured in the **browser** bench (`bench:matrix`), like-for-like, one
variable, dist rebuilt between variants:

1. S2 sort at target scale (50k): status `completed ×3` (currently
   `partial ×3`), and `interaction_latency_ms` within **~2x of TanStack's**
   measured in the same run.
2. No regression at hypothesis scale (3k): `interaction_latency_ms` at or
   below the current 50–59ms band.
3. Grouped rebuild gate (`rebuild_slice_max_ms`) untouched and green.
4. Node decomposition rerun for the work accounting (informational, not the
   latency claim).

## Design

### Unit 1: query-delta classifier

A pure function over the old and new compiled plans:

```
classifyQueryDelta(oldPlan, newPlan) -> {
  derivationsChanged: boolean
  filtersChanged: boolean
  groupsChanged: boolean
  sortChanged: boolean
  filterAuthorityChanged: boolean
}
```

plus a derived predicate `isSortOnlyChange(delta)` requiring: derivations
identical (reusing `derivationsEqualForPlan`), filters identical, rowGroups
identical, filter authority identical, sort authority identical (#467, which
landed after this spec was drafted, added `CompiledSortAuthority`; under
external authority the runtime sort is `[]`, so the classifier compares
**runtime** facets and a sort change under external authority classifies as
no runtime sort change — it stays on today's path), and sort different. The
caller additionally requires operation `set-query`.

**Conservatism rule:** any comparison the classifier cannot decide structurally
classifies as _changed_. The slow path is always correct; the classifier can
only cause missed optimizations, never wrong results. This is the property the
tests pin.

### Unit 2: synchronous rebuild path

In `setQuery`, when `isSortOnlyChange` holds **and** the query is ungrouped
(`rowGroups.length === 0`, both plans):

1. **Carryover, per old record:**
   - `filterPasses` and `groupPath` carried verbatim (filters and groups are
     unchanged by precondition; `groupPath` is `[]` for ungrouped).
   - Sort-key **values** sourced from the old metadata where the column was
     already active under the old plan; accessors run only for newly-active
     sort columns. Accessor failures surface the same
     `PretableRowModelError("accessor-failed", …)` as the slow path.
   - New `sortKeys`, `dependency`, and `aggregateLeaves` are constructed
     around the carried values (they embed the dependency object, which
     changes with the sort, so the objects are rebuilt; the _values_ are not
     recomputed).
   - New record frozen with the new metadata.
2. **Sort:** `Array.sort` over the filter-passing records using the new plan's
   `compareRows`. Comparator errors (custom comparator returning NaN/non-number)
   surface exactly as on the slow path.
3. **Bulk build:** visible tree via the existing deferred-measure transient
   (`createDeferredMeasureTransientOrderStatisticTree`,
   `order-statistic-tree.ts:918`); rows map via its transient
   (`asTransient()`/`freeze()`).
4. **Publish:** one new revision root, one emission, synchronously inside
   `setQuery`. Cause kind `set-query`, same shape as a cooperative finish.

**In-flight transitions:** an active cooperative transition is superseded
exactly as an ordinary overlapping `setQuery` supersedes it today (release the
candidate, capture the current published root). The fast path adds no new
lifecycle states.

**Streaming:** because the path completes atomically, `setRows` arriving after
it applies to the already-published root through the normal incremental path.
There is no window in which deltas need replaying.

### Instrumentation and gates

- The fast path reports its wall time under a new instrumentation field (e.g.
  `work.synchronousRebuildMs`), **not** as a scheduler slice.
  `rebuild_slice_max_ms` keeps its meaning (cooperative slices only).
- The bench gate configuration gets an explicit note: the flat sort fast path
  is exempt from the slice bound **by design** (see the synchronous-burst
  decision above).
- The existing candidate diagnostics are untouched; the fast path never
  constructs a candidate.

## Error handling

- Accessor failure on a newly-active sort column: `PretableRowModelError`
  with the same code, operation, rowId, and columnId as the slow path would
  produce. The model's state is unchanged on throw (the new root is built
  fully before publish).
- Custom comparator misbehavior: same `TypeError` as `compareValues` throws
  today, thrown during the synchronous sort, state unchanged on throw.
- Classifier uncertainty is not an error — it routes to the slow path.

## Testing

TDD throughout (test first, watch it fail, implement).

1. **Classifier:** table-driven cases per facet (sort added/removed/reordered/
   direction-flipped; each other facet changed alone → not sort-only;
   authority flip → not sort-only). Conservative-default cases pinned.
2. **Equivalence:** for the same inputs, the fast-path root is observably
   identical to the slow-path root — visible order, per-row metadata contents
   (sortKeys, filterPasses, aggregate leaf values), revision/cause shape.
   Cover: sort → different sort, sort → unsorted (`[]`, source order),
   unsorted → sort, newly-active sort column, multi-column sort, custom
   comparator, active filters present (unchanged), aggregates present.
3. **Old behavior survives:** delete-the-feature mutation — with the fast path
   forced off, the suite still passes; with it on, sorting still _sorts_
   (assert row order, not merely that the path ran). Fixture data chosen so a
   wrong order is distinguishable from the right one.
4. **Errors:** accessor-failure and comparator-failure tests on the fast path,
   asserting state is unchanged after the throw.
5. **Streaming/supersede:** `setQuery` (fast) during an active cooperative
   transition; `setRows` immediately after a fast `setQuery`.
6. **Verification protocol:** Node decomposition rerun (work accounting);
   browser A/B per the one-variable protocol — rebuild react `dist` between
   variants, same machine window, n≥5, pretable and TanStack from the same
   run. The latency claim is made only from this measurement.

## Follow-ups (filed, not built)

- Filter-change fast path on top of the classifier (values survive, verdicts
  re-run).
- Grouped-query carryover (the grouped bulk builder exists; reuse would cut
  its evaluate share).
- Progress publishes, only if target-scale results still breach the window.
