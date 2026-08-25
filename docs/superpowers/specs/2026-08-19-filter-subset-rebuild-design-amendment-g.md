# Amendment G: renderer membership path + model levers

**Amends:** `2026-08-19-filter-subset-rebuild-design.md` (its "Renderer:
untouched" section is superseded — decision 2026-08-19 after F4's NO-GO).
**Evidence:** `blank-viewport-diagnosis.md`, `reingest-composition.md`
(scratchpad).

## What F4 + diagnosis established

1. A latent controller defect (scroll during any active replacement leaves
   the stale window unpainted → blank) was made deterministic by the
   synchronous filter commit. **Fixed in G1** (commit 0deb7e90): the
   active-branch `setViewport` republishes a stale-but-visible window,
   preserving `rebuilding` status and the old observedRevision.
2. The settle attribution was corrected by profile: the controller's
   cooperative replacement costs ~4µs/survivor (~45–63ms); the rest is the
   model's own synchronous rebuild. Journal-ops lose to a subset layout
   path above k≈2–9k flips; `refilter()` ceiling ≈ 20–25ms at 50k.

## G-workstream design

### G2 — RebuildProgressDemo retarget (website)

The demo's filter toggle is synchronous now; its subject is cooperative
progress. Retarget the toggle to a GROUPED change (rowGroups on region) —
grouped stays cooperative by design and reads naturally in the demo's
prose. Same migration discipline as the cycle-1 sort→filter retarget:
demo + test + embedding-page prose all truthful.

### G3a — journal reason `"refilter"`

Reset reason union gains `"refilter"`: asserts the visible row ORDER of
surviving rows is unchanged and row identities are stable — membership
changed (rows entered/left), nothing else. Published by the filter fast
path instead of `"bulk-replace"`. Fail-closed exactly like `"reorder"`
(unaware consumers treat any reset as full replacement — grid-core pin
extended; api reports regenerated; docs guards checked — the B1+B2
playbook).

### G3b — layout-core `refilter(source)`

Sibling of `reorder()`: walks the new order; reuses existing entries by
key (measurements ride); keys ABSENT from existing entries are inserted
with the estimate-or-default height rule; existing keys absent from the
new order leave (tombstone per the retention policy — read what the
cooperative path does with measured leavers and match it). Synchronous;
same immutability/counters/diagnostics discipline as `reorder`. Throws
only on structural impossibilities (duplicate keys, bad rowCount);
membership deltas are its PURPOSE, not an error.

### G3c — controller refilter path

`synchronize`: reset reason `"refilter"` with aligned revision → capture
anchor → `rowHeights.refilter(replacementSourceOf(target))` → anchor
restore → publishReady; ANY throw → `startReplacement` fallback
(counters: `refilterPathCount`, `refilterFallbackCount` on the existing
seam). Mid-replacement: fail-closed (restart) this cycle — no compose
(membership + pending catch-up is exactly the complexity the reorder
compose rule excluded; the FINAL-retarget machinery is not extended).

### G3d — model store sharing (the −17ms lever)

On a filter-only change the new plan's sort configuration is identical
(classifier-guaranteed), so `filter-rebuild` ADOPTS the previous plan's
sort-key store rather than refilling per row: a plan-internal seam
(`adoptSortKeyStore(nextPlan, previousPlan)`, guarded by TypeError unless
the caller holds a filter-only delta — document caller-owned precondition)
points the new plan's `#sortKeys`-bearing cache at the previous plan's
map... **Design constraint:** the merged cache entry also holds guarded
metadata keyed to the OLD plan's evaluations; adopting the map wholesale
would leak OLD metadata into NEW-plan cache hits, which is WRONG (verdicts
changed). Resolution: adopt only if the metadata-hit guard also checks
plan epoch, OR share at the sortKeys level only — the implementer
proposes the minimal sound mechanism (options: entry-level plan tag;
separate keys map shared by reference while metadata cache stays fresh —
note this re-splits what the rehash fix merged, so it must NOT reintroduce
a second per-row WeakMap fill on the hot path: sharing BY REFERENCE means
zero new sets). If no sound mechanism exists without re-growing per-row
work, drop G3d and record why — it is an optimization, not a bar
requirement.

## Bar (unchanged) and projection

50k settle ≤ same-run TanStack (~58ms band): model rebuild at realistic
flip counts (~36ms verdicts + merge/build + O(k)) + refilter ~10–25ms +
frame. The bench's 75%-flip cell is the worst case and may land above
TanStack's own worst case — evaluate the bar on the MEASURED numbers and
report honestly; the reserve lever (per-filter verdict decomposition)
remains named for a miss.

## Testing

G2: demo tests assert the cooperative cycle over the grouped toggle.
G3a: B1's journal-suite pattern (all-refilter range → "refilter"; mixed →
degrade; unaware-consumer pin in grid-core).
G3b: reorder's suite pattern + membership cases (enter/leave/disjoint,
measured leavers tombstoned, estimates for entrants; equivalence oracle vs
full replace at every rank; mutation-hardened).
G3c: B4's suite pattern (happy path, fallback flavors, anchor semantics,
mid-replacement restart).
G3d (if kept): cache-correctness adversarial tests — a NEW-plan evaluate
after adoption must NOT hit OLD metadata; keys resolve with zero refills.
End-to-end: F4 re-run, all four bars.
