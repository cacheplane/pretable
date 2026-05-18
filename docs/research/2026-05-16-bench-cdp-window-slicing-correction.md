# Bench CDP window slicing — correction to PR #145 — 2026-05-16

## Summary

PR #145's investigation analyzed the **full trace** (page-load to bench-result publish), which made `getEstimatedRowHeightSignature` look like the leading hotspot at ~1.6-2 ms self-time. With interaction-window slicing now in place, that signal **disappears** — F8's cost is during initial mount of 3000 rows, not the filter trigger. The actual interaction-window hotspot for filter-text/S2/hypothesis is **`matchesFilters`** at `packages/grid-core/src/derived-rows.ts:73` — 800 μs (15%) of the 6.97 ms trigger-to-first-frame window in this n=1 sample. Cause: the function lowercases the cell value on every filter pass across all 3000 source rows; nothing is cached between filter calls.

This PR ships the slicing infrastructure (markers + analyzer option) but **no production fix**. The actual `matchesFilters` optimization is queued as the next follow-up.

## What ships

- `apps/bench/src/bench-runtime.ts` — three `performance.mark()` calls: `pretable.interaction.start`, `.firstFrame`, `.settled`.
- `apps/bench/tests/bench.spec.ts` — added `blink.user_timing` to the CDP `Tracing.start` categories so the marks land in the captured trace.
- `scripts/analyze-cdp.mjs` — new `--window=interaction|settle|full` flag. Default remains `full` for backwards compatibility. Window slicing filters ProfileChunk samples by reconstructed sample timestamps (chunk-start + cumulative deltas).

## Trace findings (n=1, interaction window)

```
Window: interaction (6.97 ms)
Total sample time in window: 5.26 ms across 26 unique nodes

Top 15 by SELF time (sourcemap-resolved):
  1127μs  (21.4%)  (program)                                native overhead
   802μs  (15.3%)  matchesFilters  packages/core/dist/index.mjs:69
   409μs  ( 7.8%)  (anon) packages/react/dist/index.mjs:29
   275μs  ( 5.2%)  u8 packages/react/dist/index.mjs:17
   272μs  ( 5.2%)  Hd react-dom-client.production.js:13346
   163μs  ( 3.1%)  xo react-dom-client.production.js:4333
   153μs  ( 2.9%)  ye apps/bench/src/bench-runtime.ts:376
   150μs  ( 2.9%)  (anon) apps/bench/src/bench-app.tsx:489
   144μs  ( 2.7%)  Ns react-dom-client.production.js:5437
   ...
```

**Notably absent:** `getEstimatedRowHeightSignature` (F8). It does not appear in the interaction-window top 26. PR #145's memo's leading hypothesis was wrong — confirmed by slicing.

## Root-cause for filter-text

`matchesFilters` (`packages/grid-core/src/derived-rows.ts:73`):

```ts
function matchesFilters<TRow extends PretableRow>(
  row: TRow,
  resolvedFilters: ResolvedFilter<TRow>[],
): boolean {
  for (const { column, needle } of resolvedFilters) {
    const haystack = String(readCellValue(row, column)).toLowerCase(); // ← runs per (row, filter call)
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
```

Called by `deriveVisibleRows` over all 3000 source rows on every filter change. Each call: read cell value, `String(...)`, `.toLowerCase()`, `.includes(needle)`. The lowercase conversion is the dominant per-row cost — `String.prototype.toLowerCase` allocates a new string, and for wrap columns with long cell text (S2's metadata/text columns) the allocation cost adds up across 3000 rows.

## Proposed fix (queued for follow-up)

**Option A — lowercase cache keyed on row + column.** Add a `Map<TRow, Map<columnId, string>>` (or `WeakMap<TRow, ...>`) of pre-lowercased cell values. Populated lazily, invalidated when row identity changes. Expected delta: ~600-800 μs reduction on filter-text — could move it from 16.79 ms p95 (PR #134's n=20) to ~16.0-16.2 ms — borderline under budget.

**Option B — pre-build a lowercase index at filter-setup time.** On `replaceFilters`, walk all rows once and build column-indexed lowercase strings. Same expected delta as A but front-loaded into the filter trigger itself (still part of the 16 ms window, but pre-sort).

**Option C — Aho-Corasick or similar string-search index.** Overkill for current sizes; revisit if filter-text complexity grows.

Recommended: A. Lowest risk, no public-API impact, internal-only edit.

## Sort + filter-metadata

Both run through the same `deriveVisibleRows` path. Sort doesn't filter, so `matchesFilters` doesn't fire — but `sortRows` uses `Intl.Collator.compare` over many pairs, which has its own cost. A separate slice of a sort trace would confirm whether `Intl.Collator` is the dominant cost there. Out of scope for this PR.

## Verdict

**No production code change in this PR.** Ships the missing infrastructure (markers + window slicing) and corrects PR #145's misattribution. Quality wedge untouched.

## Out-of-scope follow-ups

- **`matchesFilters` lowercase cache** — the actual perf fix. Next PR.
- **Sort-script flame-graph slice** — confirm whether `Intl.Collator` is the sort-script hotspot.
- **filter-metadata flame-graph slice** — same code path as filter-text; should drop with A.
- **Matrix-runner CDP integration, Speedscope export** — same status as PR #143.

## Lesson (saved to memory)

CDP traces capture the entire page lifecycle. The bench's measured `interaction_latency_ms` only counts the trigger-to-first-frame window. Always slice to the interaction window before naming a hotspot — full-trace top-N can be dominated by mount-time work that doesn't count against the metric.
