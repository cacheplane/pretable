# Dense-handle core: slots, bitsets, and columnar evaluation

Date: 2026-08-24. Status: approved design, pre-plan.
Branch: continues `blove/filter-fast-path` (held unmerged by decision; the
filter fast-path branch folds into this arc and lands with it).

## Problem

The filter fast-path arc (F/G/H cycles + post-H commits, HEAD `27e8168c`)
took 50k S2 filter settle from 241.8ms to 158.3ms, but the spec bar — settle
≤ same-run TanStack (~67ms) — is missed at 2.4–2.7×, and the final trace
attribution (`filter-final-results.md` §4) says the bar is not reachable from
the current representation: the remaining 134ms window is dominated not by any
algorithm but by a single architectural fact — **string row ids are the
currency of every hot path**. Each per-row step pays string hash + HAMT
traversal, several times over:

- `sourceOrder` entries are `{rowId, sourceOrder}` — resolving the record is
  a 50k-lookup HAMT walk (18.5ms attributed to `filter-rebuild.ts` directly).
- The old verdict is a second lookup on the same string
  (`rowPassesFilter` → `visible.rows.get` → byId HAMT, 11.9ms).
- `hashString` alone is 10.4ms — re-hashing strings whose hashes never change.
- The per-row verdict pass is row-at-a-time polymorphic evaluation (18.3ms).
- The renderer repeats the pattern: a `visibleKeys` HAMT rebuilt per
  replacement (~7ms), a frozen rowRef allocated per row.

Sort pays the same currencies: 50k sort settle is 266ms with a 247ms block on
this branch (300/279 on `main`).

## Goal and bars

Make the whole row-model commit pipeline — filter, sort, transactions,
grouping, and the renderer seam — speak **dense integer handles** internally,
so every O(n) pass is array-resident. String ids remain the public currency;
the public API is expected to be unchanged (any diff must be deliberate).

Success bars (bench protocol: medians of 3, same-run TanStack controls in
band, port 4173 free, no `grep|head` on gates):

1. **50k S2 filter-metadata AND filter-text settle ≤ same-run TanStack**,
   completed ×3, zero blank frames.
2. **50k S2 sort settle ≤ same-run TanStack** (bar value read from the same
   run's TanStack settle, not the latency band).
3. **Any single main-thread block ≤ 50ms** on every measured script. A path
   that cannot meet this at some scale must size-gate to the retained
   cooperative path at that scale rather than ship a longer block.
4. **No regressions**: 3k cells, mount, interaction latency (15–18ms band),
   grouped gate (`rebuild_slice_max_ms` ≤ 8), anchor/focus/selection
   preservation, full repo suites, `api:check`.

## Non-goals

- Replacing the persistent structures as source of truth (the full-columnar
  / flat-array core was probed and rejected: old-snapshot validity is
  load-bearing at four call sites and flat mutation measured 4.7–401ms per
  commit vs the tree's 0.16ms — `index-representation-probe.md`).
- Refinement incrementality (monotone filter-as-you-type narrowing scans
  only current members). Orthogonal, semantic, filed as follow-up.
- Worker offload, WASM, or SharedArrayBuffer anything.
- Re-adding stored per-record verdicts. Membership IS the verdict (H-cycle
  invariant) — it just becomes a bitset.

## Architecture

Three new row-model-internal primitives sit UNDER the existing persistent
structures. The HAMT and order-statistic trees remain the identity/order
source of truth; rank queries, snapshot semantics, `orderIsProven`, and
`derivedById` all carry over.

### Slot allocator (per model instance, not per revision)

Every row gets a small integer slot for its lifetime: assigned at ingest,
stamped on the record (`record.slot`), released to a free-list on permanent
removal, reused. Capacity grows monotonically — streaming inserts never
renumber existing rows.

### Slot vectors (immutable, chunked, copy-on-write)

Two-level arrays: a chunk table over 1024-element chunks. A commit touching
k rows copies ~min(k, ceil(n/1024)) chunks plus the table; reads are two
indexed loads. Used for `recordsBySlot` and the columnar caches.

**This is what keeps old snapshots valid under slot reuse**: each revision
holds its own immutable chunk table, so revision N's arrays still bind slot
s to whatever row owned s at revision N. A held snapshot's answers cannot
change when a later revision frees and reuses the slot.

### Membership bitsets (immutable, whole-copied)

50k rows = 6.25KB; whole-copy per commit is negligible even at streaming
rates — no COW machinery. Two bitsets matter per revision: the **live set**
(slots currently bound to rows — the scan domain) and the **visible set**
(filter membership, ungrouped). Old-vs-new verdict diff = XOR + word-scan of
set bits, replacing ~100k HAMT lookups.

### Columnar evaluation cache

`compiled-query`'s evaluation cache becomes per-referenced-column slot-indexed
vectors. The verdict pass becomes, per filter, a monomorphic scan over the
live-set domain producing a bitset, combined across filters by AND. Cache
adoption across filter-only plan changes generalizes the existing
`adoptEvaluationCache` (by-reference, tagged by the writing plan). Keys that
encode numerically take typed-array storage, which also gives sort a numeric
fast path.

Memory character: ~n × referenced columns × 8B (~2MB at 50k × 5 columns).
M0 measures how much of this the current cache already pays.

## Component inventory

| Component                                                       | Change                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `slot-allocator.ts` / `slot-vector.ts` / `membership-bitset.ts` | new, row-model internal                                                                         |
| `compiled-query.ts`                                             | columnar cache; monomorphic per-filter scans; bitset AND combine                                |
| `filter-rebuild.ts`                                             | records via `recordsBySlot`; diff via bitset XOR; merge + bulk build unchanged in shape         |
| `sort-rebuild.ts`                                               | sort survivor slot arrays on columnar keys; bulk tree build                                     |
| `transaction-draft.ts` / `row-store.ts`                         | slot assignment/release; chunk-COW writes; live-set maintenance                                 |
| `cooperative-transition.ts`                                     | RETAINED as the size-gate fallback; reads the same slot structures                              |
| `persistent/order-statistic-tree.ts`                            | entries carry slot; internal byId keyed by slot (no string hashing in `get`)                    |
| `group-index.ts`                                                | leaf trees hold slots; `rowParents` a slot-indexed vector                                       |
| react + layout-core seam                                        | `visibleKeys` HAMT → bitset; rowRefs pooled by slot; refilter/reorder consume slot permutations |

## Data flow — filter-only commit, ungrouped, 50k

1. Classifier (existing) proves filter-only.
2. Next plan adopts the columnar cache by reference.
3. Per-filter columnar scan over the live set → AND → new visible bitset.
4. XOR old visible bitset; iterate flipped words → flippedIn / flippedOut.
5. Flip-ins resolve records by `recordsBySlot[slot]`, keys from columnar
   vectors; k log k sort of flip-ins only.
6. Linear merge with the old tree walk (`range`, materialized), bulk build
   with `orderIsProven` + `derivedById` gated on removals < survivors — all
   as shipped today.
7. Publish with `"refilter"` journal reason; renderer permutes heights
   bitset-driven.

Estimated window from the trace attribution: ~55–75ms settle, model block
well under 50ms. Estimates are estimates; M0 and per-milestone measurement
are the authority.

## Error handling / invariants

- Dev-mode fail-loud: `recordsBySlot[record.slot] === record` per revision;
  allocator double-release / out-of-range access throws.
- Test-time equivalence oracle: bitset membership ≡ tree membership on every
  rebuilt path.
- Instrumentation counters extended: bitset diffs, columnar scans, chunk
  copies — so work assertions stay pinnable and mutation-hardened.

## Testing

- **Property equivalence**: random transaction/query sequences run through
  the new pipeline and compared exactly (visible order + membership) against
  the current implementation's results.
- **Snapshot-validity pin**: hold a snapshot; remove a row; insert a new row
  that REUSES its slot; assert the held snapshot's answers are unchanged.
  Mutation twin: break the chunk-COW deliberately and watch it fail.
- **Existing work assertions survive**: filter-only commit rebuilds zero
  records, writes zero rows-map nodes (`filter-verdicts.test.ts`,
  `filter-fast-path.test.ts` pins carry forward).
- **Chunk-copy bound pinned**: a commit touching k rows copies ≤ f(k) chunks.
- Bench certification per the bars above, under the measurement protocol
  (one variable at a time, rebuilt dist per side, controls in band, gates
  redirected to files and exit codes checked).

## Milestones (each independently measured; M0 gates the arc)

- **M0 — Node pricing probe.** Bitset diff, columnar scan, and slot-vector
  maintenance under a streaming transaction mix, at 50k, in isolation
  (method proven by `index-representation-probe.md`, whose browser
  prediction landed within 2ms). Go/no-go numbers before production code.
- **M1** — allocator + vectors + `recordsBySlot`; rebuild loops stop calling
  `rows.get` (−18.5ms est.).
- **M2** — membership bitsets + XOR diff replace the double lookup (−22ms est.).
- **M3** — columnar verdict scan (−13ms est.).
- **M4** — sort on slot arrays + columnar keys.
- **M5** — renderer seam (bitset `visibleKeys`, pooled refs).
- **M6** — grouping conversion (leaf trees + `rowParents` on slots).
- **M7** — certification against all bars; size-gate any path missing the
  50ms block bar; PR of the combined arc (this + the held filter branch).

## Carried context (do not re-litigate)

- G3d (`fillSortKeysFromPrevious` adoption) was collected by `27e8168c`;
  close it, don't execute it.
- The order-statistic tree is finished as a target (8.5ms).
- A verdict-Set probe and a memoized grouped comparator both measured flat
  and were reverted; the waste is re-hashing, not the container.
- Membership-as-tree-measure rejected with numbers (H spec).
- `derivedById` is correctly declined at 50/50 flip ratios (pinned at 49/51).
