# Pretable wrapped-text filter perf diagnostic — 2026-05-13

## Summary

The captured Playwright trace is an SDK action trace (API events + snapshots),
not a Chrome DevTools performance recording, so a function-level flame-graph
breakdown of the trigger-to-first-changed-frame window is not available from
this artifact. The diagnostic falls back to a code-reading hypothesis: pretable's
post-filter render pipeline calls `estimateRowHeight` over **every row that
survives the filter** (~500 rows for S2/hypothesis filter-text), and each such
call may perform wrap-aware text layout for wrap-enabled columns when the row
isn't in the layout cache. This work is plausibly the dominant chunk of the
~17 ms p95 budget-miss on filter-text / sort / filter-metadata; it generalizes
naturally to sort (whole-list re-ordering invalidates the rendered-rows index)
and to filter-metadata (same code path, smaller result set). Verdict:
memo-only; no Phase D fix shipped because the hypothesis needs a real
performance trace to confirm before any production code change.

## Context

PR #134 (n=20, Chromium S2/hypothesis):

| Script | mean (ms) | σ (ms) | Budget |
| --- | --- | --- | --- |
| sort | 17.10 | 1.83 | ≤ 16 |
| filter-metadata | 17.51 | 2.44 | ≤ 16 |
| filter-text | 16.79 | 0.31 | ≤ 16 |

All three reliably over the 16 ms single-frame budget. PR #141 reframed the
homepage prose to acknowledge over-budget honestly while emphasizing the
2-3.5× comparator wedge (pretable remains the fastest measured grid). This
memo identifies what consumes the budget.

filter-text picked for tracing because it has the tightest σ (0.31 ms) at
n=20 — cleanest signal.

## Method

- Single bench run via `apps/bench/tests/bench.spec.ts` with
  `PRETABLE_BENCH_ADAPTER=pretable / SCENARIO=S2 / SCALE=hypothesis /
  SCRIPT=filter-text`.
- Trace: `status/traces/2026-05-13-pretable-filter-text-perf.trace.zip`.
- Summary metrics (single sample, 3,000 rows, filter narrows to 500):
  - `interaction_latency_ms`: 8.20 ms (single-sample noise vs the n=20 mean
    of 16.79 ms; matches the documented ±0.31 σ width — n=1 lands wherever
    the GC / paint phase falls)
  - `settle_duration_ms`: 16.70 ms
  - `post_interaction_blank_gap_frames`: 0
  - `post_interaction_anchor_shift_px`: 0
  - `post_interaction_row_height_error_p95_px`: 1
  - `rendered_rows_peak`: 6
  - `result_row_count`: 500

## Trace breakdown

**The captured `.trace.zip` is a Playwright SDK action trace, not a Chrome
DevTools performance recording.** Only API calls (`goto`, `expect`,
`evaluate`, `waitForFunction`), frame-snapshots, and screencast frames are
present — there is no JavaScript-task timeline, no Chrome flame-graph data,
and no per-function duration breakdown for the trigger-to-first-frame
window. Inspection of `unzip -p ...trace.zip trace.trace | jq` confirms
only 4 `before`/`after` API events, 8 `frame-snapshot` entries, 1
`screencast-frame`, and 3 `log` entries. The trace viewer can replay these
visually, but a subagent without an interactive browser cannot extract a
scripting-task breakdown from this artifact.

**Status:** Trace-based flame-graph analysis is BLOCKED. Hypothesis below is
derived from source-code reading of the post-filter render pipeline, not
from measured task durations. A follow-up diagnostic with
`page.context().tracing.start({ ...screenshots, snapshots, sources: true })`
plus an explicit `chromium.startTracing(page, { categories: [...] })` call
(or a manual Chrome DevTools recording captured during a `--headed` run)
would be required to confirm the hypothesis.

## Hypothesis for the gap

The likely dominant cost is `estimateRowHeight` running across **every row
that survives the filter**, not just rows in the rendered (overscan) window.

Trace path through the code (verified by reading, not measured):

1. `setInteractionPlanOverride` (the bench's trigger) updates the
   adapter's `interactionPlan` prop. The adapter passes
   `planToState(plan)` into `<PretableSurface state={...} />`
   (`apps/bench/src/pretable-adapter.tsx:258`).
2. `usePretable` (`packages/react/src/use-pretable.ts:175-236`) sees the
   new `state.filters` and calls `grid.replaceFilters(...)` synchronously
   during render. This invalidates the core's
   `cachedSnapshot`/`cachedVisibleRows`
   (`packages/grid-core/src/create-grid-core.ts:150-167, 819-825`).
3. `useSyncExternalStore` re-reads `getSnapshot()`, which calls
   `deriveVisibleRows({ columns, filters, rows: sourceRows, sort })`
   over all 3,000 source rows — `filter` + `sort` work for the filter-text
   needle (`packages/grid-core/src/derived-rows.ts:25-42`). This is
   O(rows × columns_with_filter) — small for filter-text (1 needle, lower-
   cased once via `resolveFilters`).
4. `createDomRenderSnapshot`
   (`packages/renderer-dom/src/create-renderer.ts:32-69`) is then called
   inside `useMemo`. **The first thing it does is
   `input.snapshot.visibleRows.map(estimateRowHeight)` over all 500
   surviving rows**, not just the 6 rendered rows. For any row whose
   identity isn't already in the `WeakMap` cache, `estimateRowHeight`
   runs `prepareText` + `layoutPreparedText` per wrap-enabled column
   (`create-renderer.ts:35-39, 118-166`).
5. Initial render measured only the ~6 rows that were in the original
   viewport's overscan window — almost none of the 500 post-filter rows
   are in the cache, so almost all 500 trigger full `prepareText` +
   `layoutPreparedText` work. With S2's wrapped-text column at typical
   widths, that's ~500 × layout-text passes.
6. After `rowHeights` is built, `planViewport` + the `flatMap` produce
   only ~6 rendered-row records — React reconciliation is small. The DOM
   update is small. The expensive chunk lives upstream of React.

This story is consistent with:

- The fact that `scroll` (9.07 ms p95, well under budget) does not
  re-derive the row list; visible rows are stable so the `estimateRowHeight`
  WeakMap is hot.
- filter-text's tight σ (0.31 ms): the work scales with `result_row_count`,
  which is deterministic for a fixed needle.
- The persistence of the budget-miss across all three interaction scripts.
- `post_interaction_row_height_error_p95_px == 1`: estimated heights are
  reasonable (no measurement-vs-estimate disagreement).

## Why sort + filter-metadata likely share this cause

`createDomRenderSnapshot` runs `estimateRowHeight` over the full
`visibleRows` list on every snapshot change, regardless of which slice
changed.

- **sort:** the visibleRows list re-orders, so `rowHeights` is rebuilt for
  all 3,000 source rows (no filter applied in this script). Per-row cost is
  cached (WeakMap keyed on row reference), so after the first sort the cache
  is hot and per-row cost should be amortized — but the per-call overhead
  (function entry, map lookup, columnsRef check, array allocation) over 3,000
  entries is non-trivial. The σ of 1.83 ms suggests intermittent GC / cache-
  miss variance, consistent with map traffic.
- **filter-metadata:** same code path as filter-text, different needle/
  column. The wider σ (2.44 ms) likely reflects the metadata column's
  different cell-value distribution (numeric/structured values may produce
  more cache-miss `prepareText` work when the column wraps).

A focused follow-up would re-run all three scripts with the same trace
capture path, confirming that `estimateRowHeight`-related stack frames
dominate in each.

## Proposed fixes (deferred — no code in this PR)

| Option | Description | Expected delta | Risk to quality wedge | Complexity |
| --- | --- | --- | --- | --- |
| A | Lazy-evaluate `rowHeights` — only compute heights for rows the viewport plan actually needs (rendered + overscan window), not the entire `visibleRows` list. Requires restructuring `createDomRenderSnapshot` to defer `estimateRowHeight` until after `planViewport` chooses the row indices. | High — should remove the bulk of the per-filtered-row cost | Medium — `planViewport` currently consumes `rowMetrics` over the full visible list to do binary-search positioning by `scrollTop`. Need a substitute (cumulative-sum index using a default-height-estimate stride, then refine only the rows that land in the window). Risk to anchor-shift / blank-gap if not handled carefully. | Moderate — touches the planning layer's contract |
| B | Pre-warm `estimateRowHeight` cache during initial render across all source rows (idle-callback or sync at mount). Amortizes the cost into mount; interactions see a hot cache. | Medium — moves the cost out of the interaction frame budget; doesn't reduce total work | Low — same cache, same outputs | Low — single mount-time hook |
| C | Memoize the entire `rowHeights` array keyed on `(visibleRows, columns, measuredHeights)` identity. Repeated interactions that return to the same filter / sort state hit the cache. | Low-Medium — only helps repeat interactions; doesn't help the first filter-text trigger | Low | Low |
| D | Use `useDeferredValue` for the snapshot, letting React yield between the snapshot reduction and the post-filter render. Doesn't reduce work; allows the prior frame to paint before re-render. | Medium — reframes "over budget" by splitting work across two frames; user-perceived latency unchanged | Low — no algorithm change | Low — single React hook |

Option A is the most attractive on raw delta but the highest risk to the
quality wedge (anchor stability + blank-gap prevention depend on
`planViewport` having accurate row heights). Option B is the safest first
move and most testable.

## Verdict

**Memo-only; no fix shipped in this PR.**

Phase D's gate condition #1 ("one obvious code change") is not satisfied
because the trace artifact is the wrong kind of trace — function-level
durations were never captured. Any code change at this point would be
speculative even with a strong code-reading hypothesis. The right next
step is a follow-up that captures a Chrome DevTools performance trace
(via a `--headed` interactive run or a custom CDP-`Tracing.start` wrapper
in the bench harness), confirms `estimateRowHeight` dominates, and only
then ships Option A or B.

This memo logs the leading hypothesis so the follow-up has a starting
point. PR #134's verdict (real-but-over-budget; pretable still 2-3.5×
faster than every comparator) is unchanged.

## Phase D

Not fired. See Verdict.
