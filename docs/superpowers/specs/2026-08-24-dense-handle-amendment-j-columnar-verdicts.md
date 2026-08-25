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
filter-only change preserves every accessor's semantics). Chunked COW via
the existing `slot-vector` module — per-commit maintenance is k chunk
copies, exactly like `recordsBySlot`.

### 3. Freshness invariant (the load-bearing rule)

**A columnar cell (columnId, slot) is written wherever metadata for that
row is evaluated** — ingest, transaction update, cooperative rebuild — the
same places that already guarantee metadata freshness. Slot reuse is
covered structurally: a new row cannot reach a committed root without its
ingest evaluation, which overwrites its slot's cells. There is no separate
invalidation pass, and no per-cell row-identity guard; the invariant is
pinned by an equivalence oracle (columnar verdicts ≡ per-row verdicts on
randomized scripts including update + slot-reuse steps) and mutation-tested
by skipping the update-path write.

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
