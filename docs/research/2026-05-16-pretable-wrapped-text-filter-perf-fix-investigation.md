# Pretable wrapped-text filter perf-fix investigation — 2026-05-16

## Summary

With the bench-harness CDP-tracing path (PR #143) and the trigger-gating path (PR #144) in place, this is the first investigation that has a real Chrome-DevTools-format flame graph of the trigger-to-first-frame window for pretable's interaction scripts. The trace identifies `getEstimatedRowHeightSignature` (`packages/renderer-dom/src/create-renderer.ts`) as the leading single user-code hotspot at ~1.6-2.0 ms self-time (≈2% of the 95-100 ms sample window). The remaining budget is consumed by `(program)` (≈47%, native overhead), `(idle)` (≈14%, paint-wait), forced-reflow `get clientWidth` reads (≈4%), and React reconciliation / DOM mutation (each <1.5%). **Verdict: no production fix shipped — the leading hotspot exists but a speculative "lazy-signature" fix attempted in this session made the metric worse because columns-ref changes during the run multiplied the signature cost. The investigation logs the data, ships the analyzer + sourcemap config so future attempts have the right tools, and queues the actual fix for a follow-up.**

## Context

PR #134's n=20 verdicts (Chromium S2/hypothesis):

| Script          | mean (ms) | σ (ms) | Budget |
| --------------- | --------- | ------ | ------ |
| sort            | 17.10     | 1.83   | ≤ 16   |
| filter-metadata | 17.51     | 2.44   | ≤ 16   |
| filter-text     | 16.79     | 0.31   | ≤ 16   |

PR #142 captured a Playwright SDK action trace and identified `estimateRowHeight` over all filtered rows as the leading hypothesis (Option B: pre-warm cache at mount was the suggested safest fix). That investigation was blocked because the trace format had no JS flame-graph data. PRs #143 + #144 fixed the harness; this is the first investigation using the new tooling.

## Method

- Worktree: `wrapped-text-filter-perf-fix`.
- Bench Vite config: enabled `build.sourcemap: true` so the production bundle ships sourcemaps for trace-frame attribution.
- Single Playwright run:
  ```
  PLAYWRIGHT_PERF_TRACE=1 \
    PRETABLE_BENCH_ADAPTER=pretable \
    PRETABLE_BENCH_SCENARIO=S2 \
    PRETABLE_BENCH_SCALE=hypothesis \
    PRETABLE_BENCH_SCRIPT=filter-text \
    pnpm bench:e2e --project=chromium
  ```
- Analyzer: `scripts/analyze-cdp.mjs <trace.cdp.json> <bundle.js.map>` — aggregates self-time per V8 CPU-profile call frame from `ProfileChunk` events, resolves minified names via the bundle sourcemap.

## Trace findings (n=1, baseline)

```
Total sample time: 87.82 ms across 128 unique nodes

Top 15 by SELF time (sourcemap-resolved):
    41485μs  (47.2%)  (program) (no-url)
    11847μs  (13.5%)  (idle) (no-url)
     3903μs  (4.4%)  get clientWidth (no-url)
     1911μs  (2.2%)  F8 = getEstimatedRowHeightSignature  packages/react/dist/index.mjs:480
     1540μs  (1.8%)  (anonymous)  packages/react/dist/index.mjs:29
     1063μs  (1.2%)  (garbage collector) (no-url)
      927μs  (1.1%)  W6  packages/core/dist/index.mjs:69
      785μs  (0.9%)  (anonymous)  packages/react/dist/index.mjs:378  (createDomRenderSnapshot map)
      781μs  (0.9%)  C  apps/bench/src/bench-app.tsx:137
      663μs  (0.8%)  (anonymous)  packages/react/dist/index.mjs:481  (getEstimatedRowHeightSignature .map)
      651μs  (0.7%)  Bd  react-dom-client.production.js:12957
      633μs  (0.7%)  h  react-dom-client.production.js:3622
      623μs  (0.7%)  (anonymous)  packages/core/dist/index.mjs:38
      514μs  (0.6%)  getAttribute (no-url)
      465μs  (0.5%)  Gt  react-dom-client.production.js:1273
```

**Call stack for F8 (sourcemap-resolved):**

```
getEstimatedRowHeightSignature
  ← estimateRowHeight
    ← (.map callback)
      ← createDomRenderSnapshot
        ← useMemo
          ← usePretable (probably PretableSurface)
```

This confirms PR #142's hypothesis-area (the cache-key logic inside `estimateRowHeight`) is genuinely on the hot path. The cost is the per-row signature stringification, not the `prepareText` / `layoutPreparedText` themselves (those would show as separate frames and don't).

## Root-cause refinement

`estimateRowHeight` has a two-tier cache:

```ts
const cached = estimatedRowHeightCache.get(row);
if (cached && cached.columnsRef === columns) {
  return cached.height; // FAST: reference equality
}
const signature = getEstimatedRowHeightSignature(row, columns); // SLOW: stringify
if (cached?.signature === signature) {
  cached.columnsRef = columns;
  return cached.height;
}
// recompute via prepareText / layoutPreparedText
```

The fast path is `cached.columnsRef === columns`. The trace shows F8 is hit ~3000 times during the run (one per row × initial mount + filter-trigger combination), suggesting the columns reference is changing across the trace window. Candidates for what mutates the reference:

- Column autosize / measurement may emit a new `options.columns` array (look at `packages/grid-core/src/create-grid-core.ts:537, 590, 627, 650, 690, 707` — all do `options = { ...options, columns: nextColumns }`).
- Bench-app: `applyCellRendererFlavor` always does `[...columns]` even for `flavor === null` — but that's wrapped in a `useMemo`, so it shouldn't re-emit per render.
- Pretable's `usePretable` → `grid.options.columns` getter returns whatever the engine currently has — if autosize fires after initial mount, the reference changes.

Confirming the trigger requires either: (a) adding a counter inside `estimateRowHeight` to count slow-path hits, or (b) attaching a debugger to see the column-ref source.

## Failed speculative fix (do not re-attempt without confirming root cause)

A "lazy signature" approach was tried:

```ts
// On first sighting (cached === undefined), store signature: null.
// On subsequent sighting with mismatched columnsRef, compute both old and
// new signatures and compare.
```

This made F8 self-time WORSE in the captured trace (1.9 ms → 2.6 ms). Reason: when columns ref changes (which happens repeatedly in the captured window), the fix computes the signature twice per row (once for cached, once for new) instead of once. Reverted.

## Proposed fix paths (for follow-up PR)

Ranked by expected delta × safety:

1. **Stabilize columns reference upstream.** Find what's emitting a new `options.columns` during the filter trigger and fix it (likely a `{...options, columns: nextColumns}` that should be a no-op when columns are unchanged). Highest payoff if root cause is genuinely "ref mutation that shouldn't be happening": fast path goes from miss → 100% hit and F8 vanishes.

2. **Cache columns-ref-identity at engine boundary.** In `grid-core`, when applying an operation that doesn't actually change columns (e.g., `replaceFilters`, `setSort`), don't allocate a new `options.columns` array. Touch only when columns truly change. Low risk, low complexity.

3. **PR #142's Option B (pre-warm cache at mount).** Amortizes signature computation into mount instead of interaction. Sound idea but solves a smaller problem now that we know columns-ref-instability is the root issue: pre-warming an unstable-ref cache doesn't help.

4. **Defer the signature check entirely.** A small refactor to skip signature when cached row signature is null AND cached height is "recent enough" by some heuristic. Adds complexity for marginal gain.

**Recommended:** option 1 or 2, after confirming the root cause with a counter probe.

## Verdict

**No production code change in this PR.** The trace identifies the hotspot but a confident fix requires confirming WHY columns reference changes during the run, which needs more instrumentation than fits one PR. Shipping in this PR:

- `scripts/analyze-cdp.mjs` — CDP-trace analyzer with sourcemap resolution.
- `apps/bench/vite.config.ts` — `build.sourcemap: true` so future bench traces have function-level attribution out of the box.
- This research memo.

The actual perf fix is queued as a follow-up. Quality wedge (anchor stability, blank-gap, row-height fidelity) untouched.

## Phase D

Not fired. The Phase D gate from PR #142's spec required "one obvious code change" — the trace surfaces the hotspot but not a single obvious fix; the speculative lazy-signature attempt got the wrong sign. Better to ship the tooling and the honest analysis than a guess.

## Out of scope follow-ups

- **Root-cause columns-ref instability.** Add a counter probe to `estimateRowHeight` and confirm what's mutating `options.columns` during filter trigger.
- **Matrix-runner CDP integration.** Per PR #143's spec.
- **Speedscope export.** Same.
- **Sort + filter-metadata profiling.** Same code path; if columns-ref-stability fix lands, all three scripts should drop together.
