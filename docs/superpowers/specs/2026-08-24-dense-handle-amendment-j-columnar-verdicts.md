# Amendment J — columnar verdict cache

Date: 2026-08-24. Status: design, pre-plan. Executes the core spec's
"Columnar evaluation cache" milestone (M3), narrowed to VERDICTS; amends it
with the mechanics the spec left open. Follows Amendment I (measured:
`...dense-layout-seam-results.md`).

## Why now, and the target

Post-seam re-attribution of the 50k filter window (74.2ms traced): verdict
evaluation (`#filterVerdict` + `evaluateFilter` accessor loop) ≈ **17.5%**,
the largest single row-model share. Per row it pays: a resolver closure, a
`#byId` Map get per filter, a live accessor call per filter, and
`evaluateFilter`'s per-row operator dispatch. M0 priced the replacement — a
monomorphic scan over a slot-indexed value vector — at 0.26ms (numeric) /
0.70ms (string `.includes`) per 50k pass.

Target: verdict share → ≲3%; untraced 50k settle from 108.3/116.8 toward
~95–105ms. Sort keys are OUT of scope (they have their own store); grouped
paths keep the per-row route.

## Design deltas beyond the core spec

### 1. `CompiledRowInput` gains `slot`

Every caller already holds the record (or is creating it and just allocated
the slot). `evaluate` and the verdict paths receive the slot so columnar
cells can be written and read without any string key.

### 2. Columnar store: per-column `SlotVector<unknown>` on the shared cache

A `Map<columnId, SlotVector<unknown>>` of RESOLVED accessor values for
FILTER columns, living beside the evaluation cache and adopted by reference
in the same `adoptEvaluationCache` call (same validity argument: a
filter-only change preserves every accessor's semantics). Storage revised
at implementation (`30c43223`): mutable-in-place chunked vectors with
per-chunk presence bitsets (`mutable-columnar.ts`), NOT the COW
`slot-vector` — sound because the store is cache-not-truth and nothing
revision-scoped ever reads it; the module header carries the argument.

### 3. Freshness invariant (the load-bearing rule — REVISED)

Revised 2026-08-24 during Task 1 review, which found the original wording
("written wherever metadata is evaluated") unsound: drafts evaluate rows
BEFORE the draft is known effective, so an aborted draft would leave cells
reflecting values that never committed, at slots the committed root still
owns. Also, two ingest paths present a `-1` placeholder slot to `evaluate`
(allocation is deliberately deferred past the throwing accessor — the
capacity-leak fix in `d64fba85`), so `evaluate` cannot be the writer anyway.

**The bulk scan is the ONLY writer** (write-through on holes). Commit-side
maintenance only CLEARS: every committed transaction clears the cells of its
changed and removed rows (k-sized, beside the existing `slotWrites` block);
a full set-rows/initial build starts from empty vectors; a non-filter-only
plan change compiles fresh shared state (vectors start empty and refill on
the next scan — extending adoption to sort-only changes is a follow-up, not
this milestone). Aborted drafts never touched the cells; entrants and
updated rows are holes until the next scan reads them once.

Pinned by: the equivalence oracle (columnar ≡ per-row verdicts on
randomized scripts including update, slot-reuse, AND a throwing-accessor
aborted-draft step), and a mutation test that skips the commit-side clear.

### 4. Holes fall back per cell

A vector missing a cell (column newly active, or a row ingested under a
plan that didn't reference the column) answers by live accessor read AND
fills the cell (write-through). First filter commit on a newly-referenced
column therefore pays one O(n) accessor pass — the same pass it pays today
every commit — and subsequent commits scan.

### 5. Compiled predicates

Per filter, resolve column + operator ONCE into a monomorphic
`(value) => boolean` closure (`compileFilterPredicate`), hoisting operand
normalization (e.g. between-bounds, lowercased needles) out of the row
loop. The bulk scan is: per filter, loop live slots over the vector,
AND into the verdict bitset. `filter-rebuild`'s walk consumes the bitset
instead of calling `filterVerdict` per row; the per-row `filterVerdict`
remains for k-sized and grouped paths, unchanged in semantics.

## Bars

- 50k filter-metadata AND filter-text settle improve vs the seam baseline
  (108.3/116.8) with TanStack controls in band; traced verdict share ≲3%.
- 3k no regression; zero blank frames; grouped gate untouched.
- Zero public API drift (everything is row-model-internal; `CompiledRowInput`
  is internal — verify, and if it leaks into a public type, stop and review).
- Equivalence oracle + freshness mutation + existing 557 row-model tests, all
  work-count pins intact.
