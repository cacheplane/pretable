# filter-keystrokes bench — first measurement round (2026-08-27)

First real numbers from the new `filter-keystrokes` script (issue #489;
design: `2026-08-27-filter-keystrokes-bench-design.md`). Purpose of this
round: prove the instrument end-to-end and record a baseline — NOT to set
budgets (none are claimed here; an evaluator/budget follows only after a
protocol-grade campaign).

## Protocol

- `pnpm bench:matrix --adapters=pretable,tanstack --scenarios=S2
--scale={hypothesis|target} --repeats=3 --scripts=filter-keystrokes`,
  output redirected to files, exit codes checked (both 0, 27 passed per
  round). Dev-scale singles came from Task 5's `bench:e2e` runs.
- Machine load 2.7–4.8 (10-core Mac, no parallel-session bench activity;
  port 4173 verified free before each round). TanStack same-run cells are
  the fitness arbiter as in every arc round.
- Medians of 3 per cell. All runs `status: "completed"`,
  `post_interaction_blank_gap_frames: 0`, expected final counts
  (dev 125, hypothesis 500, target 8 334).

## The headline finding the single-commit scripts could not see

At 50k (S2 `--scale=target`), pretable's **warm** filter commit is ~34 ms
cheaper than its **cold** one:

| Cell (medians of 3)   | cold `keystroke_first_total_ms` | warm `keystroke_warm_total_p50_ms` | cold − warm |
| --------------------- | ------------------------------- | ---------------------------------- | ----------- |
| pretable, 50k         | **108.3** (108.0/108.3/116.0)   | **74.2** (65.4/74.2/74.4)          | ~34 ms      |
| tanstack, 50k         | 57.3 (49.8/57.3/57.8)           | 50.0 (41.4/50.0/51.3)              | ~7 ms       |
| pretable, 3k          | 40.6 (33.4/40.6/41.6)           | 40.2 (32.6/40.2/41.8)              | ~0          |
| tanstack, 3k          | 32.4 (32.3/32.4/35.0)           | 33.2 (31.5/33.2/33.3)              | ~0          |
| pretable, dev (1 run) | 32.8                            | 33.1                               | ~0          |
| tanstack, dev (1 run) | 33.3                            | 33.9                               | ~0          |

- The cold 50k number (~108 ms) reproduces the dense-handle arc's known
  single-commit settle (104–108 ms) — the instruments agree where they
  overlap, and `interaction_latency_ms`/`settle_duration_ms` (commit 1's)
  land in the same bins as `filter-text`'s.
- The **warm** 50k number (~74 ms) is the first measurement of pretable's
  repeat-commit filter path ever taken. The ~34 ms cold−warm gap is real
  headroom the single-commit scripts structurally cannot observe — the
  quantity whose invisibility forced the columnar verdict cache's revert.
  Note what it does NOT yet isolate: commit 2 narrows 41 666 → 8 334 rows,
  so it still pays a large visible-set rebuild; a warm commit over a small
  result set would be cheaper still.
- TanStack's 50k cells sit in the same 48–58 ms band as every arc round's
  controls — the regime held; the numbers are comparable to the arc record.
- At 3k and below, cold and warm are indistinguishable (both inside 4–5
  frame-quantized bins) — the fill cost is below frame-interval noise at
  small scale, consistent with the arc's 3k findings.

## Instrument finding: S2 yields exactly 2 commits at every scale

`keystroke_commits_observed` = 2 in all 18 summaries. S2's `col_0` value
pool gives the "Bonjour" prefix family only two distinct count classes
(rows containing "b" ≈ 5/6 of the set; rows containing "bonjour" ≈ 1/6);
every intermediate prefix ties its neighbor and is dropped by the
sequence-validity rule, leaving "B" (cold) + "Bonjour" (warm). Two
consequences, both by design rather than defect:

1. The cold/warm split — the metric that matters — is fully delivered:
   commit 2 runs against a genuinely warm engine.
2. The warm DISTRIBUTION degenerates: p50 = p95 = max within a run (one
   warm sample); across repeats a cell still yields 3 warm samples.
   `keystroke_commits_observed` reports this honestly, exactly as the
   design intended for collapsed sequences.

**Follow-up filed for whoever needs a longer warm tail** (e.g. a columnar
re-evaluation wanting per-keystroke amortization over 5+ commits): either
scenario data with graded prefix counts for the needle family, or a
second needle chosen against the existing pool. Do not silently switch
the needle — the full-needle final state is what keeps `filter-keystrokes`
comparable to `filter-text`.

## What this unblocks

- **#488 (size-gate)**: this script is the certification instrument at
  both scales — a sync/cooperative dispatch gate must hold the warm
  number, not only the cold one, and now both are visible.
- **Columnar verdict cache re-evaluation** (preserved at `73f1ae24`): the
  warm row is the one that cache targets. With one warm commit of ~74 ms
  at 50k, a warm-path saving now has a number to move — but note the
  2-commit sequence limits amortization claims to "second commit", not
  "Nth keystroke", until the follow-up above lands.

## Fitness statement

Light-load round (2.7–4.8 on 10 cores), no traced runs, medians of 3,
TanStack same-run controls in the historical band on every cell. Warm
p95/max are NOT distribution statistics in this round (single warm sample
per run) and were not used above.

## Amendment (2026-08-28, #509): the needle grew a graded tail

`KEYSTROKE_FILTER_NEEDLE` is now `"Bonjour depuis Pretable token-123"` —
typing continues through the message text into a token id, which the
EXISTING S2/S7 pool grades: 5 surviving commits at dev scale and above
(B → Bo → …token-1 → …token-12 → …token-123), 4 at smoke. Scenario data
untouched, so no historical number moves. The `filter-text` comparability
survives as the committed "Bo" step (equal count ⇒ equal set under
monotone narrowing — it selects the byte-identical row set to "Bonjour").

Live verification (single runs): 3k — 5 commits, cold 33.4, warm
p50/p95/max 25.8/42.1/42.1. 50k (cooperative, post-#488-gate) — 5
commits, zero long tasks, cold 267, warm totals 275/175/151/183: note
that narrowing 109 → 12 rows still costs ~180 ms — the cooperative
rebuild's cost tracks the RESIDENT population, not the result set, which
is the warm-path re-verdicting the reverted columnar cache targeted.
