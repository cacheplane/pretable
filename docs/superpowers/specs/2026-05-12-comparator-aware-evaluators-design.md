# Comparator-Aware Evaluators Design

**Date:** 2026-05-12
**Status:** Draft (awaiting user review before plan)
**Predecessors:** [PR #130 cell-renderer comparators](../../research/repo-memory.md), [PR #131 sort+filter comparators](../../research/repo-memory.md), [PR #132 homepage interaction wedge refresh](../../research/repo-memory.md).

---

## Goal

Extend the six pretable-only evaluators (H6, H7, H8 interaction + H19, H20, H21 cell-renderer) in `scripts/bench-matrix.mjs` to include comparator-adapter evidence in their `evidence` arrays. Same pattern as `evaluateH1`, which already surfaces competitor series alongside pretable. Result: `hypotheses.json` becomes a single source of truth for cross-adapter perf data, retiring (eventually) the per-PR aggregator scripts currently feeding the `/bench` page.

## Why

After PRs #130–#132 opened the supportedScripts gate on cell-renderer and sort/filter scripts for all four adapters, the matrix captures comparator runs but the H6/H7/H8/H19/H20/H21 evaluators only summarize pretable's row in their `evidence` arrays. Consumers needing cross-adapter data (the `/bench` page, the homepage's `ComparisonTable`, future tools) have to read per-run summary files via aggregator scripts — that pattern was acceptable for one PR but has now repeated three times (PR #130 cell-renderer, PR #131 sort+filter, PR #132 interaction homepage refresh).

H1 already implements the right shape: its `evidence` array contains pretable's summary plus the best-full-grid comparator and the best virtualization-primitive comparator. Reuse that shape on the six other evaluators.

## Non-goals

- **No threshold or status-logic changes.** Pretable's absolute thresholds still drive verdicts; comparator data is informational. This avoids unintentional status flips.
- **No `/bench` page update.** The page still reads its aggregator JSONs from PRs #130/#131/#132. A separate follow-up can swap it to read from `hypotheses.json` once the new evidence shape is proven. Out of scope.
- **No new hypotheses.** Six existing evaluators get richer; no H22+ added.
- **No homepage update.** Same reasoning as the `/bench` page.
- **No cross-browser data.** Chromium-only, mirroring all prior B2 work.
- **No re-thresholding of H6/H7/H8** despite PR #134's finding that pretable's filter-text + filter-metadata land over the 16 ms single-frame budget. That re-thresholding is editorial / scoping work — separate from this architectural change. The evaluator thresholds stay as-is; this PR just adds data alongside.

## Architecture

### Evaluator extension pattern

Each of the six target evaluators currently:

1. Finds pretable's series for the relevant slice.
2. Computes pretable's metrics (`summarizeRunSeriesEvidence`).
3. Applies absolute thresholds → status.
4. Returns `{ id, status, summary, evidence: [pretableEvidence] }`.

The extension:

1. Same steps 1–3.
2. Find each comparator's series for the same (scenarioId, scriptName) slice.
3. Summarize each comparator that has a completed series.
4. Append each comparator's evidence to the array: `evidence: [pretableEvidence, ...comparatorEvidences]`.
5. Status unchanged — still pretable-only thresholds.

The comparator lookup mirrors `evaluateH1`'s `groupRunSeries(runs, { scenarioId, scriptName }).filter(...)` pattern — same helper functions, no new utilities needed.

### Per-evaluator slice definitions

| Evaluator | Scenario | Script | Comparators |
| --- | --- | --- | --- |
| `evaluateH6` | S2 | `sort` | ag-grid, tanstack, mui |
| `evaluateH7` | S2 | `filter-metadata` | ag-grid, tanstack, mui |
| `evaluateH8` | S2 | `filter-text` | ag-grid, tanstack, mui |
| `evaluateH19` | S2 | `scroll-with-format` (compared to `scroll` baseline) | ag-grid, tanstack, mui — but only on `scroll-with-format` slice; baseline stays pretable |
| `evaluateH20` | S2 | `scroll-with-render` | ag-grid, tanstack, mui |
| `evaluateH21` | S2 | `scroll-with-heavy-render` | ag-grid, tanstack, mui |

H19 is the tricky one: its current verdict compares format-overhead (`scroll-with-format`) against a `scroll` baseline, both pretable. The comparator data adds value on the `scroll-with-format` slice (comparator's format overhead vs its own scroll baseline would be a deeper extension; out of scope). For H19 we surface comparator `scroll-with-format` evidence alongside pretable's existing format + baseline; comparators' format-vs-baseline overhead is informational, not gated.

### Test updates

`scripts/__tests__/bench-matrix.test.mjs` has existing tests for each evaluator. Two new tests per evaluator:

1. Positive: with comparator runs in the input, the evidence array contains comparator entries.
2. Regression: with no comparator runs, the existing pretable-only behavior is unchanged.

Existing positive/negative tests (status verdicts) stay unchanged since status logic is unmodified.

### Matrix re-run

One matrix invocation to produce a fresh milestone with all six evaluators populated:

```
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable,ag-grid,tanstack,mui \
  --scenarios=S2 \
  --scripts=scroll,sort,filter-metadata,filter-text,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=3
```

7 scripts × 4 adapters × 3 repeats = 84 runs. Wall-clock ~5 min based on PR #131 / PR #132 precedent.

Milestone path: `status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json`. The original B2 / autosize / sort-filter / cell-renderer milestones stay intact.

### Sanity check on existing verdicts

After the matrix runs, compare the new hypotheses.json statuses to the existing milestone status entries (pre-existing from PRs #127/#130/#131). All six should retain their current `satisfied` status — the evaluator logic for status didn't change, only the evidence shape. If anything flips, that's either a runtime fluke (re-run once) or an evaluator bug surfaced by the refactor (STOP and investigate).

## Out of scope follow-ups

- **`/bench` page swap to read from hypotheses.json.** Smaller editorial PR after this lands.
- **Retire aggregator scripts** (`scripts/extract-interaction-summary.mjs` and the inline aggregators baked into earlier milestones). Once the page reads from hypotheses.json, the aggregators can go.
- **H19 comparator-format-overhead semantics.** Currently H19 = pretable's format overhead vs pretable's scroll baseline. The comparator version would be each comparator's format-overhead vs its own scroll baseline (a per-adapter delta). Surface comparator format p95 alongside but don't compute their deltas — that's a future enhancement.
- **The 4 editorial recommendations from PR #134** (homepage prose updates, ComparisonTable budget column, TanStack trail-marker, pretable filter perf-fix investigation). Pending user editorial review on #134.

## Risks

- **Evaluator output shape change might break downstream consumers.** Mitigation: the `/bench` page reads aggregator JSONs, not `hypotheses.json` directly. The matrix-runner tests cover shape; if anything reads `hypotheses.json` evidence shape, that surfaces in `pnpm -w test`.
- **Comparator series lookup edge cases.** If a comparator has `status: "unsupported"` for the slice (which doesn't happen for the six target scripts anymore since the gate was opened), the existing helpers handle it. Verified by reading `evaluateH1`'s pattern.
- **H19 format-overhead semantics drift.** If a future reader assumes the H19 evidence array represents format-overhead deltas for every entry, they'd be wrong — only pretable's entry is the delta; comparator entries are absolute format p95. Document this in the evaluator's docblock to head off confusion.

## Test plan

- Unit: each of six evaluators gains a "with comparator runs, evidence array includes comparator entries" test.
- Unit: each of six evaluators retains its existing status-logic tests (no changes to those).
- Integration: `pnpm -w test` passes (existing matrix-runner test suite covers report shape).
- Manual: matrix re-run produces a fresh milestone JSON; spot-check that H6/H7/H8/H19/H20/H21 evidence arrays each contain 4 entries (pretable + 3 comparators).
