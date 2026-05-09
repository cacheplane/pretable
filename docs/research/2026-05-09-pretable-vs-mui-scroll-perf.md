# Pretable vs MUI scroll perf - 2026-05-09

## Summary

The S2/hypothesis scroll-frame-p95 gap from the B2 comparative runset did not survive a 20-repeat rerun. Pretable averaged 9.07 ms and MUI averaged 9.14 ms, so the original 1 ms MUI advantage at n=3 was sample noise; this investigation stops here and does not capture additional traces.

## Context

The B2 comparative bench runset (PR #123) showed pretable's scroll p95 at 9.7 ms vs MUI X DataGrid Community's 8.7 ms on S2/hypothesis at 3 repeats. That result was directionally interesting because pretable rendered fewer DOM nodes and fewer visible rows, but the measurement was statistically thin: at 3 repeats, p95 is effectively a max-of-3 comparison.

This memo tightens that slice only. It does not evaluate other scenarios, other scripts, or other browsers, and it does not change pretable's scroll path. The goal was to decide whether the 1 ms delta warranted profiling work before scoping a perf-fix PR.

## Method

- Matrix: `pnpm bench:matrix --project=chromium --adapters=pretable,mui --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=20`.
- Runset: `2026-05-09t02-08-14-979z`.
- Hardware: MacBook Pro, Apple M1 Max, 10 cores, 32 GB RAM.
- Background load disclaimer: the run used the normal local machine environment. No process priority, scheduling, or load-control changes were applied. Load was nonzero around the run window, so this should be read as a practical local harness result rather than a lab-isolated benchmark.
- Statistical test: 2σ comparison on mean `scroll_frame_p95_ms`. A gap is treated as real only when `abs(mean_pretable - mean_mui) > 2 * max(sd_pretable, sd_mui)`.

## High-repeat data

| Adapter  |   n | mean p95 (ms) | sd (ms) |  min | median |  max |
| -------- | --: | ------------: | ------: | ---: | -----: | ---: |
| pretable |  20 |          9.07 |    0.20 | 8.70 |   9.10 | 9.40 |
| mui      |  20 |          9.14 |    0.19 | 8.60 |   9.15 | 9.30 |

Source: `status/milestones/2026-05-09-perf-diag-high-repeat.scroll.json`.

## Statistical verdict

The high-repeat result is noise. The measured mean difference was -0.065 ms (`pretable - mui`), meaning pretable was very slightly faster on this rerun. The 2σ noise floor was 0.401 ms, computed from the larger standard deviation across the two adapters. Because `abs(-0.065) < 0.401`, the observed difference is well inside the local measurement noise.

This also means the original B2 finding did not merely shrink from a 1 ms MUI advantage to a smaller confirmed MUI advantage. It changed sign. At this sample size and variance, there is no evidence that MUI has a meaningful S2/hypothesis scroll-frame-p95 advantage over pretable.

## Interpretation

The practical conclusion is that the B2 H1 flip for this slice was an artifact of low repeat count, not a confirmed scroll-path regression in pretable. The B2 runset was still useful because it found a suspicious comparator edge, but the high-repeat diagnostic removes the reason to spend a follow-up PR on trace analysis or a targeted scroll optimization.

The narrowness of the rerun distribution is also useful context. Both adapters clustered tightly around 9 ms, with standard deviations around 0.2 ms and overlapping min/median/max ranges. That profile is consistent with two implementations sitting at effective parity for this scenario under the current harness.

## Verdict

Gap is noise; H1's threshold is sensitive at low repeats. Do not ship a perf-fix PR for pretable vs MUI S2/hypothesis scroll based on the B2 n=3 result.

Recommended follow-up: raise the repeat protocol for the H1 comparator-parity slice, or at least for cases where the best-comparator margin is near the threshold. A default of 10 repeats for H1-sensitive scroll comparisons would likely catch this class of sample artifact without making every matrix run as expensive as this diagnostic.
