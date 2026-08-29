# Grouping-Apply Insert Phase (#500 cycle 2) — Design

**Status:** approved direction, specced in full.
**Parent:** `2026-08-29-grouping-apply-cooperative-cost.md` (cycle 1: seal
units + clock — merged as PR #518). Cycle 1 fixed the seal phase; this fixes
the insert phase, which measurement showed dominates: **~2.9s of the ~3.2s**
at 50k rows × 10 `avg` columns.

## The cost, measured (investigation 2026-08-29; scripts in session scratchpad)

Per row, per grouping level, per aggregated column, the build inserts into
TWO ordered AVL aggregate trees (`all` + `filtered` roots): ~5.8µs and
~1.4KB of heap per row·column — perfectly linear at ~289ms/72MB per column on
a 314ms zero-aggregate base. Three structural facts make this waste, not
work:

1. **The comparator never reads values.** `compareAggregateLeaves` orders by
   row sort keys only, so a group's 20 aggregate trees are isomorphic — the
   engine builds 20 identical AVL shapes per group and shares nothing.
2. **Scalar kinds don't need order.** `sum`/`avg`/`count` are commutative
   with **exact inverses** (bigint superaccumulator subtraction; count
   decrement; ±Infinity as counters), and streaming updates already arrive
   as remove-then-insert with the originally-inserted value on the removal
   record. Only `min`/`max` (no inverse) and **custom aggregator specs**
   (associativity is the only validated law — the fold order is observable)
   need a removal structure. The real builtin `avg` measures ~0.11µs per
   scalar accumulate — ~50× under the tree path.
3. **One population root is write-only.** `aggregateFilteredRows` is a
   model-lifetime option; `aggregateRecord` finalizes only the selected
   root. The other root is built and never read (its `firstId` serves only a
   vestigial error-context path).

## Decisions

1. **(A) Kind-aware aggregation.** `sum`/`avg`/`count` columns get a scalar
   accumulator cell behind the same root interface
   (`insertOrReplace`/`remove`/`finalize`/`firstId`): insert = accumulate,
   remove = exact inverse (bigint units subtraction, count decrement,
   ±Infinity flags become counters so `Inf + (−Inf) → NaN` finalize
   semantics survive; NaN admission applied symmetrically on both sides).
   `min`/`max` and custom specs keep the ordered tree unchanged. Scalar
   columns charge **no seal units** (accumulate is O(1) inline at insert);
   the cooperative resumable-unit contract is untouched for the kinds that
   still seal. `firstId` on a builtin-only scalar group may return
   undefined — its only consumer is custom-finalizer error context.
2. **(C1) Build only the selected population root.** The unselected root
   (`filtered` when `aggregateFilteredRows` is on — the option selects the
   `all` population — and `all` otherwise) is
   write-only today; stop building it. Halves the remaining tree cost for
   min/max/custom AND the scalar-cell writes. `representativeRowId` falls
   back to the root that exists. The option is model-lifetime, so nothing
   can request the dropped root later.
3. **(micro) `normalizedLeaf` stops copying frozen leaves** — it currently
   allocates a fresh frozen copy of an already-frozen leaf on every insert
   (~157ms + GC at 50k×10). Return the input when it is already canonical.
4. **Rejected: bulk tree construction at seal (shape B)** — the O(n)
   `createOrderStatisticTreeFromSortedEntries` primitive exists, but B keeps
   the full allocation/GC bill, needs non-resumable per-group sorts inside
   the cooperative seal, and under A+C1 the residual tree count is too small
   to repay that; **rejected: multi-measure shared trees (C2)** — mostly
   redundant once A lands, large typing/instrumentation churn.
5. **Streaming stays the CONTROL and should strictly improve** — scalar
   cells make per-touch group updates O(1) where trees were O(log n). The
   S5 group-updates 20k p95 (10.0ms) must not regress; any improvement is
   welcome but not claimed in advance.

## Invariants that must be test-pinned (the risk register, made checkable)

- **Inverse exactness**: insert/remove fuzz (randomized adds/removes incl.
  NaN, ±Infinity, duplicates) comparing the scalar cell against a tree
  oracle for sum/avg/count — final values identical, intermediate finalize
  identical at every step.
- **Remove-then-insert invariant**: streaming updates must keep arriving as
  remove-then-insert (scalar cells cannot detect replace); pin it with a
  test that fails if an update path skips the remove.
- **±Infinity finalize semantics**: `Inf`, `−Inf`, and mixed populations
  finalize identically to the tree path, including after removals that
  clear one flag.
- **Custom specs untouched**: an order-sensitive custom aggregator (one the
  associativity law permits but commutativity would break) produces the
  SAME fold as before — proving customs still ride the ordered tree.
- **C1 twins**: both `aggregateFilteredRows` configs run the full aggregate
  fixture set; a filter making the two populations differ proves the
  SELECTED root is the one surviving.
- **Cycle-1 pins hold**: unit-accounting and slice bounds re-derived for
  scalar columns charging zero seal units (the existing pins' fixtures use
  aggregated columns — update the derivations honestly, don't loosen).

## Verification

- The pins above; the full row-model + react suites untouched-green.
- Node repro (50k×10avg): time-to-grouped from ~3.2s to **≤ 600ms** (target
  ~400-450ms; the gate at 600 leaves loaded-box headroom), heap Δ from
  ~780MB to ≤ 200MB.
- Bench, same-window controls: S2 `group`/`group-expand` at target scale
  return **`completed`** (the #500 headline); settle reported against the
  ~400ms pre-#321 number; S5 `group-updates` 20k p95 ≤ 10.0ms (control);
  3k/750 settles reported. Isolated port, full output to files.
- Changeset: `@pretable-internal/row-model` patch.
- #500 closes only if S2 target completes; else it stays open with the
  residual named.

## Out of scope

The renderer-dom height-index cost (filed, task chip); shape B / C2
(rejected above, revisit only with new evidence); any change to budget or
slicing constants; the jsdom setDerivations stall.
