# Amendment I — dense-identity layout seam

Date: 2026-08-24. Status: design, pre-plan. Amends
`2026-08-24-dense-handle-core-design.md` (executes its "renderer seam"
milestone, promoted AHEAD of the columnar cache by measurement).

## Why the promotion

M1+M2 took 50k filter settle 166.6 → 116.8ms (`...m1-m2-results.md`). The
2026-08-24 re-attribution of the remaining ~117ms (traced interaction window,
shares): **layout `refilter` ≈ 33%** (16.8% walk + 13.6% string-HAMT
`hashString`/`lookupEntry`/`set` + 2.4% OST rank reads), row-model rebuild +
verdict pass ≈ 29%, renderer/react commit ≈ 25%. The columnar verdict cache
(spec M3) caps at ~14%. The layout seam is the same string-identity disease
M1+M2 cured in row-model, and it is now the single largest lever. Columnar
follows as the next milestone after this one.

## What the seam pays today (measured anatomy, 50k refilter)

1. `replacementSourceOf` (`renderer-dom/row-layout-controller.ts:1444`):
   `entryAt(index)` → `snapshot.rowAt(index)` — an O(log n) order-statistic
   rank descent PER ROW → O(n log n) for the walk, plus ref/identity
   stringification per row.
2. `RowHeightIndex.refilter` (`layout-core/row-height-index.ts:1582`): per
   row, ~4–5 string-hash operations — `unconsumed` Map set (old pass), `seen`
   Set add, `visibleKeys` HAMT insert (rebuilt FROM SCRATCH every refilter),
   `unconsumed.get`; entrants add `hashGet(measurements)` (+ tombstone
   lookups).

## Design

### 1. Dense keys cross the seam as an OPTIONAL contract

- Row-model snapshot gains an internal-facing visible-row read that exposes
  the record's `slot` and the root's `slotCapacity` alongside the existing
  ref (exact shape decided in the plan after reading the snapshot module;
  the public `publicRow` object is NOT touched). It must also expose a bulk
  in-order visible walk (the tree's materialized `range`) so the source stops
  paying a rank descent per row.
- `RowHeightReplacementSource` entries gain optional `denseKey: number` and
  the source gains optional `denseCapacity: number`. When every entry of a
  replacement/refilter/reorder carries a dense key, `RowHeightIndex` runs its
  dense lane; any entry without one falls back to the string lane wholesale
  (no mixed-lane pass). String `identity` REMAINS the durable identity in
  both lanes.

### 2. Two-tier measurement store inside `RowHeightIndex`

- **Hot lane (dense, slot-keyed):** the per-pass O(n) structures — the
  refilter walk's `unconsumed`/`seen`, the `visibleKeys` membership, and the
  current-measurement lookup for LIVE rows — become bitsets / dense arrays
  sized by `denseCapacity`.
- **Cold lane (string-keyed, unchanged):** tombstones (`tombstones`,
  `tombstoneOrder`) and any measurement whose row is not currently live.
  Tombstones CANNOT go dense — a slot is lifetime-bound and REUSED after
  permanent removal, while a tombstone's whole purpose is to outlive the row.

### 3. The slot-reuse invalidation contract (THE trap of this milestone)

A slot-keyed measurement is valid exactly as long as the slot binds the same
row. `refilter` never crosses a slot release (filter leavers keep their model
slots — they are hidden, not removed). Permanent removals reach the layout
index only through full replacements (`beginReplacement`) — the plan pins
that claim in code review before anything is built on it — so:

- refilter/reorder may trust slot-keyed hot state unconditionally;
- a FULL replacement rebuilds hot state from its own walk and must fold
  retiring measured rows into the cold (string) tier by identity, exactly as
  today's retention semantics demand;
- the pin that keeps this honest: filter row X out (tombstoned), permanently
  remove X, add row Y that REUSES X's slot, refilter Y visible — Y must
  ingest at estimate height, and X's retained measurement must return only
  on X's identity, never attach to Y. Mutation-hardened both ways.

### 4. What stays put

- Retention semantics, ticket order, cap eviction, the fallback-on-throw
  contract, and every observable of `refilter`/`reorder` are UNCHANGED —
  equivalence oracle: dense lane vs string lane must produce identical
  observable sequences on randomized flip scripts.
- The blank-viewport latch and anchor semantics (G3c) are untouched.

## Bars

- 50k refilter's layout share (walk + its HAMT + OST reads, traced shares)
  drops to ≲ 10% of the window; untraced 50k filter settle ≤ ~95ms
  (from 116.8/125.6) with long-tasks reduced accordingly; 3k no regression;
  TanStack controls in band; zero blank frames; refilterFallbackCount 0.
- Deliberate API surface: layout-core types and row-model internal snapshot
  reads WILL move `.api.md` — every line of that diff is reviewed and
  intended (M1+M2's zero-drift property ends here by design). The docs
  api-surface guard is test-pinned to those reports; if it fires, the
  registered tables update in the same commit, per the guard's contract.

## Explicitly out of scope

- The columnar verdict cache (next milestone).
- Renderer/react commit costs (~25%) — different levers (memoization,
  windowed commit), different milestone.
- Any change to grouped replacement paths beyond keeping them compiling on
  the string lane.
