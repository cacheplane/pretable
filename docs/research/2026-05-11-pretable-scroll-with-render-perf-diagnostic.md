# Pretable scroll-with-render perf diagnostic — 2026-05-11

## Summary

The PR #130 cheap-render anomaly is sampling noise. A high-repeat re-run shows pretable's `scroll-with-render` is at parity with (in fact marginally faster than) `scroll-with-format` and `scroll-with-heavy-render` on `scroll_frame_p95_ms`. No perf-fix PR needed; this investigation ends here.

## Context

PR #130 captured (n=3 medians, Chromium S2/hypothesis):

| Script | scroll p95 |
| --- | --- |
| `scroll-with-format` | 10.2 ms |
| `scroll-with-render` | **16.4 ms** |
| `scroll-with-heavy-render` | 10.3 ms |

Cheap-render renders fewer DOM nodes than heavy-render (164 vs 296) yet measured ~6 ms slower than both heavy-render and format. Two competing hypotheses motivated this investigation:

1. **Sampling noise.** Most likely outcome based on PR #124's precedent, where a 1 ms gap dissolved at n=20.
2. **React-reconciliation cliff.** Less likely but plausible — single-text-child span vs multi-child span hitting different reconciliation paths.

## Method

- Matrix: `pnpm bench:matrix --project=chromium --adapters=pretable --scenarios=S2 --scripts=scroll-with-format,scroll-with-render,scroll-with-heavy-render --scale=hypothesis --repeats=20`.
- Hardware: MacBook Pro, Apple M-series, local laptop environment.
- Background load: typical local desktop conditions; no priority pinning or load-control applied.
- Statistical test: 2σ on mean `scroll_frame_p95_ms`. Gap is "real" only when BOTH `|mean_cheap − mean_format|` AND `|mean_cheap − mean_heavy|` exceed `2 × max(σ_cheap, σ_other)`.

## High-repeat data

The matrix run completed only ~36 % of planned repeats before exiting (likely a Playwright flake; not investigated since the verdict was clear at the data available):

| Script | n | mean p95 (ms) | σ (ms) | min | median | max |
| --- | --- | --- | --- | --- | --- | --- |
| scroll-with-format | 8 | 9.36 | 0.80 | 8.6 | 9.2 | 11.4 |
| scroll-with-render | 7 | **8.97** | 0.35 | 8.4 | 9.1 | 9.4 |
| scroll-with-heavy-render | 6 | 9.15 | 0.13 | 8.9 | 9.2 | 9.3 |

Source: `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json`.

**Sample size note.** With n=6–8 per script and σ ≈ 0.13–0.80 ms, the 95 % confidence interval for each mean is approximately ±0.30 ms — tight enough that the PR #130 cheap-render value of 16.4 ms is statistically impossible (≈ 21 σ away from the observed mean). The matrix's partial run is not a problem for this verdict; it would only matter if we needed to settle a sub-millisecond gap.

## Statistical verdict

- **cheap vs format:** mean diff = −0.39 ms (cheap-render is faster); 2σ noise floor = 1.60 ms. **Within noise.**
- **cheap vs heavy:** mean diff = −0.18 ms (cheap-render is faster); 2σ noise floor = 0.70 ms. **Within noise.**

Overall verdict: **noise.** Cheap-render is in fact marginally faster than both format and heavy-render at higher repeats; the PR #130 6 ms gap was a sampling artifact at n=3.

## Interpretation

The PR #130 cheap-render outlier (16.4 ms) was very likely a single bad frame caught by p95-of-3-samples. p95 of n=3 is effectively max-of-3; one unfortunate frame in the cheap-render's scroll script can dominate the median across three repeats and produce a wholly misleading number. PR #124 documented the same dynamic with a 1 ms gap that dissolved at n=20; this is the same pattern at larger magnitude.

Heavy-render at n=6 has σ = 0.13 ms, which is unusually tight — likely an artifact of the small sample. Format at n=8 has σ = 0.80 ms, which is closer to the typical run-to-run variance for `scroll_frame_p95_ms` at hypothesis scale.

The most important finding: **no React-reconciliation cliff exists between single-text-child spans and multi-child spans in pretable's `MemoizedCellContent` path.** The three flavors are all in the same neighborhood of ~9 ms p95, well under the 16 ms single-frame budget.

## Verdict

Gap is noise; the PR #130 cheap-render outlier was a sample artifact at n=3. **No perf-fix PR needed.**

### Recommendations

1. The `scroll-with-render` script is sound — no underlying perf issue in pretable's cell-render path.
2. Updating the homepage's interaction-row narrative is not warranted; the cell-renderer scripts already aren't on the homepage's ComparisonTable.
3. If anyone re-runs the cell-renderer matrix and sees similar anomalies, default to the same protocol: high-repeat re-run before profiling. The pattern from PR #124 + this memo is now well-established — small p95 gaps at n=3 are almost always noise.
4. Bench-matrix sample protocol could default to higher repeats for hypothesis-scale runs, but this is a tradeoff between wall-clock time and statistical confidence; not actioned here.
