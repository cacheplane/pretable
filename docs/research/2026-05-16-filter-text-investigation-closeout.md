# Filter-text perf investigation closeout — 2026-05-16

## Summary

Closing the wrapped-text filter perf-fix investigation thread that ran through PRs #142, #143, #144, #145, #146. After landing the full CDP + sourcemap + interaction-window-slicing pipeline, the data shows **the 1-2 ms budget miss on filter-text/sort/filter-metadata is not concentrated in any single scripting hotspot large enough to reliably close**. The leading interaction-window scripting hotspot is `matchesFilters` at ~0.6-0.8 ms self-time (~14% of in-window scripting); eliminating it would move filter-text from 16.79 ms p95 to ~16.0-16.2 ms — still grazing the 16 ms single-frame budget. PR #134's homepage reframe ("real-but-over-budget; pretable still 2-3.5× faster than every comparator") remains accurate. **No production code change shipped from this investigation chain.**

## What this investigation produced

| PR | What landed |
|---|---|
| #142 | First diagnostic memo; identified harness gap (Playwright action trace ≠ flame graph) |
| #143 | Opt-in CDP tracing (`PLAYWRIGHT_PERF_TRACE=1`) |
| #144 | `waitForTrigger=1` gate so CDP attaches before bench interaction runs |
| #145 | First flame-graph diagnostic + `scripts/analyze-cdp.mjs` + bench sourcemaps; misattributed `getEstimatedRowHeightSignature` from full-trace view |
| #146 | `performance.mark` window bounds + `--window=interaction` slicing; corrected #145; identified `matchesFilters` |
| (closed) | This memo. |

The infrastructure is permanent and reusable for any future bench-perf investigation. The lesson — always slice to the interaction window — is saved to repo-wide memory.

## Why no fix shipped

Single-trace n=1 interaction window: ~6-8 ms. PR #134's n=20 p95: 16.79 ms. The ~10 ms gap between single-sample and p95 is in **paint/composite/native browser work** that the V8 CPU profiler doesn't fully attribute. Even reducing the entire `matchesFilters` cost to zero would only save ~0.7 ms; the remaining budget miss lives outside scripting.

A `WeakMap<row, Map<columnId, lowercaseStr>>` cache for `matchesFilters` would help real-world multi-character typing (where filter triggers repeat as the user types) but **does not help the bench scenario** (single trigger per run). Shipping it would have been a real-world improvement with zero bench-metric movement; arguably worth doing as a separate small PR, but not under the "fix filter-text budget miss" banner.

## What the captured data actually shows

Interaction window for `pretable / S2 / hypothesis / filter-text` (n=1, 6.77 ms):

```
  4822μs  (47.2%)  (program)                                       native overhead
   773μs  ( 7.6%)  matchesFilters  packages/grid-core/src/derived-rows.ts:73
   507μs  ( 5.0%)  (anon) packages/react/src/pretable-surface.tsx
   253μs  ( 2.5%)  u8 packages/react/dist/index.mjs:17
   220μs  ( 2.2%)  bench-runtime.ts:376  (probe-row read)
```

Top RasterTask: 908μs (single tile). Total raster: ~3 ms across many small tiles. Total Layout/UpdateLayoutTree: <1 ms.

So in a ~7 ms interaction window:
- ~5.4 ms attributable JS (incl. native overhead)
- ~1-2 ms paint/raster/composite

The bench p95 of 16.79 ms must reflect either:
- Variance: some runs hit slow GC / cache-miss paths the trace didn't sample.
- Aggregate paint cost across the multi-frame settle window (not just first-changed frame).
- Mount-time work bleeding into the timer (though `startTimestamp` is post-rAF, so this should be excluded).

Identifying which would require capturing 20+ traces and statistically attributing per-run timing — significantly more work than this investigation's scope.

## Recommended next steps (if anyone returns to this)

1. **Capture n≥20 CDP traces and aggregate.** The current analyzer works on a single trace; extending it to aggregate p95-per-frame across traces would let us attribute the actual long-tail.
2. **Shift focus to settling/paint, not scripting.** The bench's `settle_duration_ms` is separate from `interaction_latency_ms`. If the budget miss is in paint, scripting-level optimizations are irrelevant.
3. **WeakMap-cached `matchesFilters` as a real-world-only PR.** Doesn't move the bench but helps live filter UX. Optional, low-risk.

## Verdict

**Investigation closed. Homepage prose (PR #141) accurately reflects the state: filter-text/sort/filter-metadata are ~1 ms over budget, pretable remains 2-3.5× faster than every measured comparator. The interaction-window scripting is already well-optimized; remaining cost is in unattributed paint/composite/native work that needs a different kind of investigation.**

## Lesson (also in memory)

CDP scripting traces alone don't explain bench latency for fast operations dominated by paint/composite. When `analyze-cdp.mjs --window=interaction` shows scripting time well below the bench's reported `interaction_latency_ms`, the remaining cost lives outside scripting; chasing scripting-level fixes for that gap is unlikely to move the metric.
