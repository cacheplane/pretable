# Filter-keystrokes bench script — design (issue #489)

Date: 2026-08-27. Follow-up to the dense-handle arc (#487); prerequisite for
judging #488's size-gate and for ever re-evaluating the reverted columnar
verdict cache (preserved at `73f1ae24` on `origin/blove/filter-fast-path`).

## Why this exists — the structural gap

The S2 interaction scripts (`filter-metadata`, `filter-text`) apply **one**
filter commit against a **cold** engine, so the measured interaction IS the
fill. That shape made the columnar verdict cache's entire benefit invisible
twice and forced its revert (see
`2026-08-24-columnar-verdicts-results.md`, "Decision: reverted"): any design
that amortizes cost across repeated commits — caches filled on first use,
warm-path optimizations, a size-gated dispatch that pays once and reuses —
cannot move a single-commit number. The product case the scripts miss is
**filter-as-you-type**: N successive narrowing commits where commit 1 is
cold and commits 2..N run against warm state.

## What the script is

A new interaction-family bench script, **`filter-keystrokes`**: starting
from an unfiltered grid, apply the prefixes of the existing text-filter
needle as successive `contains` filter commits on `col_0` —

```
"B", "Bo", "Bon", "Bonj", "Bonjo", "Bonjou", "Bonjour"
```

— waiting for each commit to fully settle before applying the next
(settled-sequential, not fixed-cadence: per-commit latency attribution
stays unambiguous), and report the per-commit latency distribution with the
**cold first commit separated from the warm rest**.

- Family: joins `interactionScripts` in
  `packages/bench-runner/src/index.ts` — S2/S7 only, supported on all four
  adapters (pretable, tanstack, ag-grid, mui). TanStack same-run cells are
  the fitness arbiter, exactly as for `filter-text` (#477 wiring).
- Scenario data note: `col_0` in S2/S7 is the wrapped multilingual text
  column the existing `TEXT_FILTER` (`"Bonjour"`) already probes; prefix
  narrowing is monotone by construction (`contains "Bo"` ⊆ `contains "B"`).

### Sequence validity — every measured step must move the count

The settle machinery latches on `createVisibleRowSignature`, whose first
component is `resultRowCount`, and viewport-clipped row identity. Narrowing
can leave the visible window's rows unchanged, so **the count change is the
only guaranteed first-changed signal**. Therefore the plan builder:

1. computes the expected row count for every prefix from the dataset
   (same `filterRows` semantics as the runtime: trimmed, lowercased,
   `includes`);
2. asserts the counts are monotone non-increasing (a violation is a plan
   bug — throw, don't note);
3. **drops any step whose count equals the previous step's** (equal count
   under monotone narrowing ⇒ identical row set ⇒ no signature change ⇒ the
   latch would starve). The final full-needle step is always kept; if its
   count equals its predecessor's, the predecessor is the one dropped.
4. The number of surviving steps is REPORTED (`keystroke_commits_observed`)
   so a smoke-scale run that collapsed to 2 commits can never masquerade as
   a 7-commit measurement.

Steps are deterministic per (scenario, scale, seed), so every adapter in a
matrix cell measures the identical sequence.

### Probes

Selection/focus probes are taken from the FINAL filtered row set (row at
`length/2`, as `filter-text` does). Monotone narrowing guarantees a final
row is present in every intermediate set, so `selected_row_preserved` /
`focused_row_preserved` answer: did selection and focus survive the whole
typing sequence?

## Measurement design

New helper `measureBenchFilterKeystrokesRun` in
`apps/bench/src/bench-runtime.ts`, looping the existing
`measureRowSetChange` once per surviving step:

- **Pre-sequence baseline**: `waitForRenderedRowBaseline` (≥2 stable
  frames of rendered rows) before commit 1 — the sort/filter scripts today
  trigger ~1 frame after remount with `quietFrames: 0`; a sequence wants a
  genuinely quiet start.
- **Per commit i**: a per-step plan (same shape as today's interaction
  plan, differing only in `filters` + `resultRowCount`) is published via
  the same `setInteractionPlanOverride` trigger the single-commit scripts
  use; `measureRowSetChange` provides the first-changed latch, the
  `resultRowCount === expected` correctness latch, the long-task observer,
  and the frame accounting. `quietFrames: 0` between commits (the previous
  commit's settle IS the quiet).
- **Per-commit total** = `interaction_latency_ms + settle_duration_ms` of
  that commit (trigger→first change→stable), the number a typing user
  feels per keystroke.
- **Any commit failing its correctness latch** (stalled at the wrong
  count, or frame budget exhausted) downgrades the whole run to `partial`
  with the failing commit index in the reason — no timings are published
  from a run whose sequence broke, mirroring the single-commit post-hoc
  validity rule.
- Frame budget: per-commit `maxFrames` reuses the `filter-text` budget
  (96); the Playwright per-test timeout (30 s) bounds the whole sequence
  with ~10× headroom at target scale.
- The existing `performance.mark("pretable.interaction.*")` marks repeat
  once per commit. Trace slicing of a keystroke run with
  `analyze-cdp.mjs --window=interaction` is NOT certified by this design;
  verifying/extending the analyzer for repeated marks is follow-up work if
  per-keystroke traces are ever needed.

## Metrics

New `BenchMetricId` entries (union + `benchMetricIds`), all emitted by the
script and required by `assertRequiredMetrics` for completed runs:

| Metric                        | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `keystroke_commits_observed`  | surviving steps actually measured (see sequence validity)      |
| `keystroke_first_total_ms`    | commit 1 trigger→settled — the COLD number (includes any fill) |
| `keystroke_warm_total_p50_ms` | median of commits 2..N trigger→settled — the WARM number       |
| `keystroke_warm_total_p95_ms` | p95 of commits 2..N                                            |
| `keystroke_warm_total_max_ms` | max of commits 2..N                                            |

The cold/warm split is the entire point: a warm-path optimization moves the
warm row and leaves `keystroke_first_total_ms` alone; a cold-path
optimization does the reverse; today's single-commit scripts see only the
cold number.

The script ALSO emits the standard interaction set (so it reads side by
side with `filter-text` and satisfies the family's metric contract):
`interaction_latency_ms` and `settle_duration_ms` are **commit 1's**
(directly comparable to `filter-text`'s cold commit);
`post_interaction_blank_gap_frames` / `post_interaction_long_tasks_*` are
summed across the sequence (a blank frame on ANY keystroke counts);
`post_interaction_anchor_shift_px`, the row-height pair, `result_row_count`
(final count), `selected_row_preserved`, `focused_row_preserved` are
end-of-sequence. The full per-commit series (value, expected count,
latency, settle) goes into `notes` — free-form, already the home of the
frame-floor disclosures.

Warm percentiles with N−1 as small as ~6 are order statistics over six
samples; p50 is the robust one, p95≈max. That is disclosed here rather
than fixed — more keystrokes would trade run time for resolution, and six
warm samples with medians-of-3 repeats matches the arc's existing
protocol.

## What is deliberately NOT in this change

- **No hypothesis evaluator / no budget gate.** Thresholds must come from
  measurement, not invention (feedback: never claim an unmeasured budget).
  The script is an instrument; runs flow into summaries/evidence
  automatically (`summarizeMetricSummary` discovers metric ids
  dynamically). #488's certification adds the evaluator once real numbers
  exist. `check-bench-budgets.mjs` is untouched (absent-script-is-failure
  rule there).
- **No website/milestone publication** (`apps/website/app/bench`,
  `status/milestones`) — nothing published until a measurement campaign
  produces defensible numbers.
- **No columnar-cache rebuild.** This script is the instrument that would
  justify or refute one; building one is a separate brainstorm.
- **No fixed-cadence (overlapping-commit) mode.** Settled-sequential only;
  overlap makes per-commit attribution ambiguous and none of the engine's
  current dispatch modes coalesce filter commits.

## Seams touched (from the exploration map)

1. `packages/bench-runner/src/index.ts` — `BenchScriptName` +
   `benchScriptNames` + `interactionScripts` allowlist + `BenchMetricId` +
   `benchMetricIds` + `assertRequiredMetrics` (own block: family eight +
   five keystroke metrics) + its tests.
2. `apps/bench/src/bench-types.ts` (`Extract` list) and
   `query-state.ts` (parse disjunction) + tests.
3. `apps/bench/src/interaction-plan.ts` — keystroke-step builder exporting
   the surviving per-step plans + tests (monotonicity, dedup, probe
   membership, determinism).
4. `apps/bench/src/bench-runtime.ts` — `BenchInteractionMode` +
   `getMaxInteractionFrames` + `measureBenchFilterKeystrokesRun` + tests.
5. `apps/bench/src/bench-app.tsx` — dispatch branch publishing successive
   plans + `measuredRuns` row + test (commits N times, in order, gated on
   `search`).
6. Adapters: `tanstack-adapter.tsx` / `ag-grid-adapter.tsx` /
   `mui-adapter.tsx` add the mode to their filter disjunction (`contains`
   semantics); `pretable-adapter.tsx` is mode-agnostic (verified by test).
7. `apps/bench/tests/bench.spec.ts` — interaction-script branch + metric
   assertions.
8. No changes to `bench-matrix.mjs` evaluators, budgets, or website.

## Verification bar

- All unit suites green (`bench-runner`, `app-bench`, plus
  `node --test scripts/__tests__/bench-matrix.test.mjs` unchanged-green).
- Reviewer-grade mutations: drop a keystroke commit → the commit-count
  metric and dispatch test fail; break monotone dedup → plan test fails;
  wrong-count stall → run downgrades to partial.
- One real end-to-end run per adapter (pretable + tanstack minimum) at
  `--scale=hypothesis` on S2 through `pnpm bench:e2e`, output redirected
  to files (NEVER through `grep|head` — SIGPIPE kills gates), summaries
  inspected: completed status, `keystroke_commits_observed` ≥ 5 at 3k,
  cold ≥ warm p50 plausibility, zero blank frames.
- Port 4173 checked with `lsof -i :4173` before any preview; never kill a
  holder (parallel sessions).
