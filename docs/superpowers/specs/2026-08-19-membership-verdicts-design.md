# Membership verdicts: cutting the filter commit's ordering rebuild

**Follows:** `2026-08-19-filter-subset-rebuild-design.md` + Amendment G.
F4's re-run (scratchpad `filter-cycle-results-2.md`) passed three bars and
missed settle 4x: 50k filter settle 216–227ms vs TanStack ~57ms, with 69%
of the window in the row model — persistent-map 45ms, order-statistic-tree
35ms.

**Date:** 2026-08-19

## What the exploration established (facts, cited in the map)

- The 80ms splits into **disjoint halves**: record/metadata rebuild + rows-map
  writes (~45ms, scales with flipped rows) and the visible tree + `byId`
  HAMT rebuild (~35ms, scales with survivors).
- `filteredLeaf` is **not** a per-leaf flag — filtered aggregation is
  membership in a separate aggregate tree (`aggregate-tree.ts:23-39` has no
  flag). The wrapper exists only to tell `updateAggregateRoots` insert vs
  remove, and both derivation sites hold a live plan.
- **The visible tree already is the membership set.** `nearestVisibleRef`
  (`visible-index.ts:212-216`) uses `rankOf(rowId) === undefined` as its
  visibility predicate today.
- Membership-as-tree-measure (considered, **rejected**): no measure-update
  primitive exists — one flip costs remove+insert (2× O(log n) node copies +
  a HAMT set), so at high flip counts it loses to the bulk build it would
  replace; it also grows the **sort** path (all rows in the tree) and breaks
  `nearestVisibleRef`. Recorded here so it is not re-proposed.

## Success criteria

1. 50k S2 filter-metadata and filter-text: settle ≤ same-run TanStack
   (~57ms band), `completed ×3`, zero blank frames.
2. No regression: 3k filter (currently 42/50ms), sort both scales, grouped
   gate ≤8, mount, full repo suites, api reports (this cycle DOES change the
   public `CompiledRowMetadata` shape — the reason must be the only diff).
3. Work assertions: a filter-only change performs **zero** record
   reconstructions and zero rows-map writes (counters); the visible tree's
   `byId` is derived by removal, not refilled (counter).

## Workstream H1 — verdicts come from root membership

`CompiledRowMetadata` loses `filterPasses`. Nothing stores a per-row
verdict; membership in the root's visible structure IS the verdict.

- **Resolution seam:** one internal helper, e.g.
  `passesFilter(root, rowId)` — flat: `root.visible.rows.get(rowId) !==
undefined`; grouped: the group index's leaf membership (the grouped path
  has its own leaf trees — the helper must answer correctly for both, or
  grouped callers use a grouped-specific accessor; implementer picks one
  coherent seam and documents it).
- **Producers** (`evaluate` / `#finalizeMetadata` / `refilterRecordMetadata`)
  stop writing the field. The verdict a producer _computes_ still drives
  where the row is inserted — it becomes a local, not stored state.
  `#finalizeMetadata` stops allocating the per-aggregate-column wrapper
  carrying `filteredLeaf`; `updateAggregateRoots` /
  `updateMutableAggregates` decide insert-vs-remove from the computed
  verdict passed alongside the record (both sites already receive plan +
  record — thread the verdict explicitly rather than re-deriving).
- **Consumers** (the 19 sites in the map) reroute: filter-rebuild's diff
  reads the CAPTURED root's membership; transaction-draft's six
  old-verdict sites read `input.root` (previous) and its new-verdict sites
  read the draft's own visible structure; distinct-values reads the root it
  already holds; group-index's `filteredCount` accumulation takes the
  computed verdict.
- **`refilterRecordMetadata` is deleted.** With `filterPasses` and the
  `filteredLeaf` wrapper gone from metadata, a flipped row needs **no new
  record at all** — filter-rebuild's rows map carries by identity in every
  case, exactly as sort-rebuild's does. This is the 45ms.
- **`rebaseSourceOrder`** (the one plan-less metadata producer,
  `transaction-draft.ts:700`) simply stops carrying the field.

## Workstream H3 — cheaper bulk tree construction

`createOrderStatisticTreeFromSortedEntries` gains an internal variant (or
options) for callers that can prove their input:

- **Derived `byId`:** accept a base map and a leaver set — the new map is
  the old one minus k leavers (k removes) instead of n inserts. Filter's
  survivors are always a subset of the captured tree's entries.
- **Trusted order:** skip the n−1 verification comparisons when the caller
  passes a proof token (filter's merge produces strictly-sorted output by
  construction from two strictly-sorted sequences; sort's `Array.sort` +
  tiebreak likewise). The verification stays the default and stays
  unconditional for untrusted callers — the rationale comment at the
  existing site explains why it exists; extend it with when it may be
  skipped.
- Both are internal primitives; no package-index exposure.

## Out of scope

- Membership-as-measure (rejected above).
- G3d sort-key store adoption (still deferred; ~17ms, revisit only if the
  bar is missed after H1+H3).
- Per-filter verdict decomposition (the standing reserve lever).
- Grouped fast paths (still cooperative).

## Testing

House standard; the sortKeys migration (cycle 2) is the template.

H1: equivalence oracles vs cold models across flat and GROUPED paths
(grouped exercises the rerouted aggregate/filteredCount consumers even
though it takes no fast path); the transaction-draft old-verdict sites get
adversarial tests — same-reference mutation flipping a row's verdict must
still emit the correct remove/insert change ops (this is the case the
row-keyed store could not serve; membership resolution must); aggregates
correct under filtered and all populations; distinct-values `filtered`
population correct; identity assertions (zero record rebuilds on a filter
change — counter-pinned); `nearestVisibleRef` semantics unchanged.

H3: byId-by-removal equals byId-by-refill (structural equality across every
key); trusted-order variant equals verified build; a deliberately
misordered trusted input is NOT silently accepted in tests (assert the
variant is only used where order is proven — a mutation that feeds it
misordered input must be caught by an equivalence oracle downstream).

End-to-end: the F4 protocol, all bars, plus the api-report review.
