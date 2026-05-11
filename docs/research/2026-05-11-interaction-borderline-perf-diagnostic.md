# Interaction borderline perf diagnostic — 2026-05-11

## Summary

- **pretable filter-text: `real-over-budget`.** At n=20, mean p95 is 16.79 ms ± 0.31 — `mean − 2σ` = 16.17 ms > 16 ms budget. Pretable's `filter-text` path is reliably ~0.8 ms over the single-frame budget; not a sampling artifact.
- **tanstack vs pretable filter-metadata: `noise-tied`.** TanStack's n=8 sample has σ = 11.6 ms (wide); the 1.6 ms mean diff is well inside the 23.2 ms 2σ noise floor. PR #131's 15.7 vs 16.0 ms readings were both within run noise.
- **Incidental finding:** pretable `filter-metadata` mean is also over budget (17.51 ms ± 2.44 at n=20). PR #131's 16.0 ms n=3 reading was a low-end sample. The homepage's "clear of the single 60Hz frame budget on filter-metadata and sort" framing is no longer accurate for filter-metadata.

## Context

PR #131's n=3 interaction matrix produced two borderline numbers:

- pretable `filter-text` at 17.7 ms (1.7 ms over the 16 ms single-frame budget).
- tanstack `filter-metadata` at 15.7 ms vs pretable 16.0 ms — the only place a comparator edged pretable.

Both within ±2 ms of budget at n=3, where p95 is essentially max-of-3. PR #124 and PR #133 set the precedent that small p95 gaps in this harness are often noise; this memo tightens both slices.

## Method

- Matrix: two runs combined.
  - Original n=20 attempt (interrupted after pretable's portion): produced 20 pretable samples per script.
  - Tanstack-only re-run: produced 8 filter-metadata + 6 filter-text samples before the matrix exited early (the same Playwright flake pattern observed in PR #133).
- Hardware: MacBook Pro, Apple M-series, local laptop environment.
- Background load: typical local desktop conditions; no priority pinning.
- Two tests:
  1. **pretable filter-text over-budget check.** `noise-within-budget` if `mean + 2σ ≤ 16 ms`; `real-over-budget` if `mean − 2σ > 16 ms`; `borderline-confirmed` if neither.
  2. **tanstack vs pretable filter-metadata parity check.** Standard 2σ test on mean difference.

## High-repeat data

| (adapter, script) | n | mean (ms) | σ (ms) | min | median | max |
| --- | --- | --- | --- | --- | --- | --- |
| pretable, filter-text | 20 | **16.79** | 0.31 | 16.10 | 16.70 | 17.50 |
| pretable, filter-metadata | 20 | **17.51** | 2.44 | 15.80 | 16.75 | 24.80 |
| tanstack, filter-metadata | 8 | 19.11 | 11.60 | 8.20 | 17.25 | 41.70 |
| tanstack, filter-text | 6 | 27.97 | 17.23 | 8.30 | 29.45 | 49.60 |

Source: `status/milestones/2026-05-11-interaction-borderline-high-repeat.json`.

**Sample size note.** Pretable's σ is tight (0.31 ms on filter-text); tanstack's is wide (11–17 ms) — the tanstack samples bounce between 8 ms and 50 ms, likely because tanstack v8's filter rebuild path interacts unpredictably with `useReactTable`'s render cycle. Even with the wide tanstack distribution, the verdicts are unambiguous on both slices (pretable's filter-text is clearly over budget; the tanstack-vs-pretable filter-metadata gap is well within noise).

## Per-slice verdicts

### pretable filter-text over-budget

- mean = 16.79 ms, σ = 0.31 ms, mean+2σ = 17.41, mean−2σ = 16.17, budget = 16 ms.
- Verdict: **`real-over-budget`**.
- Even the lower 2σ bound (16.17 ms) is above the single-frame budget. Pretable's `filter-text` path is reliably ~0.8 ms over budget on Chromium S2/hypothesis at this dataset size. The PR #131 n=3 reading of 17.7 ms was on the high side but directionally accurate; the high-repeat number is 16.79 ms — about 1 ms tighter than PR #131 suggested, but still over the budget.

### tanstack vs pretable filter-metadata parity

- pretable mean = 17.51 ± 2.44 ms (n=20); tanstack mean = 19.11 ± 11.60 ms (n=8).
- mean diff (tanstack − pretable) = +1.60 ms; 2σ noise floor = 23.19 ms.
- Verdict: **`noise-tied`**.
- The PR #131 n=3 numbers (tanstack 15.7, pretable 16.0) were both individual draws from distributions that span 8–25 ms (pretable) and 8–42 ms (tanstack). The 0.3 ms gap at n=3 was a low-end sampling artifact on both sides; at higher repeats neither edges the other.
- **Settle-time confound note:** PR #131 measured tanstack settle at 26.5 ms vs pretable 16.7 ms (1.6× slower). Even if a tanstack-faster latency verdict had surfaced, total time-to-stable would still favor pretable. With the latency itself now confirmed as tied, the settle gap remains pretable's wedge.

## Interpretation

The pretable filter-text over-budget verdict is a real finding that conflicts with the current `/bench` page prose ("fractionally over on filter-text"). At n=20 it's not "fractional" — it's 5 % over budget at the mean, and the lower 2σ bound is still over budget. The page should either:

- Acknowledge filter-text is reliably over budget (≈ 17 ms) and re-frame the wedge as "2–3.5× faster than every measured comparator on every script; clears the single-frame budget on sort but lands a frame late on filter-text and filter-metadata"; or
- Investigate the filter-text path for an optimization opportunity (likely candidates: the wrapped-text filter row-model recomputation, post-filter scroll-anchor work, or the cell-render pipeline triggered by the visible-rows churn).

The incidental finding — pretable filter-metadata also over budget at the mean — is more striking. PR #131 reported it at 16.0 ms (right at the edge); the n=20 mean is 17.5 ms with σ = 2.44 ms. That's a much wider distribution than filter-text's 0.31 ms σ, suggesting filter-metadata's perf is sensitive to something stochastic (initial scroll position? telemetry timing? row-selection state?). Worth investigating alongside filter-text.

The tanstack-tie verdict is unambiguous and the recommended cleanup is small: drop the "filter-metadata ties pretable" annotation from the homepage trail-marker label since at higher repeats neither adapter clearly leads on this slice — the comparison is noise. The `/bench` page already notes "within run noise" in prose; no change there.

## Recommendations

1. **Update `/bench` page prose.** Move filter-text out of the "clears the budget" set; acknowledge it lands one frame late at n=20. Same for filter-metadata. Frame the comparative wedge as "2–3.5× faster than comparators" without claiming sub-frame budget compliance on those two scripts. Editorial-only PR.
2. **Update ComparisonTable.tsx interaction rows.** Numbers are correct (16.0 / 17.7 ms from PR #131's n=3) but the `budget` column shows "≤ 16" which now reads as a fail badge for pretable on filter-metadata + filter-text. Two options: (a) keep the column and accept pretable shows over-budget on those rows; (b) drop the budget column for interaction rows since the comparative-wedge story doesn't depend on absolute budget compliance for those scripts. Editorial decision.
3. **Update TanStack trail-marker label.** Current: "Headless; ~2× slower interaction (filter-metadata ties pretable)". Drop the filter-metadata parenthetical — the high-repeat data shows no real tie on that script (both adapters are wide-distribution at n>3; the "tie" at n=3 was sample noise).
4. **Scope a perf-fix investigation for pretable filter-metadata + filter-text.** Both reliably over budget on this dataset. Likely shared root cause (the wrapped-text filter pipeline); a single profiling pass could surface candidates. Lower priority than narrative cleanup but worth the investigation.

## Verdict

Two real findings: pretable's filter-text path is reliably over the single-frame budget (and filter-metadata likely too); the tanstack vs pretable filter-metadata tie at n=3 was sampling noise.

**Hold this PR for user review** — the recommendations above involve homepage prose and trail-marker label changes that warrant editorial sign-off, plus a potential perf-fix follow-up.
