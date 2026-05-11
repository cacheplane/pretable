# Interaction Borderline Perf Diagnostic Design

**Date:** 2026-05-11
**Status:** Draft (awaiting user review before plan)
**Predecessors:** [PR #131 sort+filter comparators](../../research/repo-memory.md); [PR #124 perf-diag](./2026-05-09-b2-followup-perf-diagnostic-design.md); [PR #133 scroll-with-render perf-diag](./2026-05-11-pretable-scroll-with-render-perf-diagnostic-design.md) — same pattern reapplied.

---

## Goal

Tighten the n=3 verdicts on two borderline numbers from PR #131's interaction matrix:

1. **pretable `filter-text` at 17.7 ms** — 1.7 ms over the 16 ms single-frame budget. Real over-budget or sample artifact?
2. **tanstack `filter-metadata` at 15.7 ms** vs **pretable 16.0 ms** — the only place a comparator edged pretable (0.3 ms diff). Tied or marginal tanstack lead?

Output is a research memo + raw evidence — no code changes. If verdicts are "noise" or "within-budget," PR auto-merges; if either is "real-over-budget" or "real-tanstack-faster," hold for user review.

## Why

PR #131 captured (n=3 medians, Chromium S2/hypothesis):

| Script | pretable `interaction_latency_ms` | tanstack `interaction_latency_ms` |
| --- | --- | --- |
| `filter-text` | **17.7 ms** | 40.2 ms |
| `filter-metadata` | 16.0 ms | **15.7 ms** |

`filter-text` 17.7 ms is the only pretable script over the 16 ms single-frame budget in the entire PR #131 runset; the page prose acknowledges this as "fractionally over." `filter-metadata` 15.7 ms is the only place tanstack edges pretable.

Both are within ±2 ms of budget at n=3, where p95 is essentially max-of-3 and a single bad frame dominates. PR #124's perf-diag dissolved a 1 ms gap at n=20; PR #133 dissolved a 6 ms cell-renderer gap at n=6–8. Both patterns suggest these borderlines could also be noise. This memo settles it.

## Non-goals

- Fixing pretable's `filter-text` path if it's over budget. Any optimization is a follow-up PR informed by this memo's verdict.
- Adding more adapter coverage. ag-grid + mui run filter-text at 50+ ms and filter-metadata at 33–49 ms — they're nowhere near the borderline; no n=20 needed for them.
- Trace capture / profiling. The borderlines are about confirming numbers, not finding a perf cliff. If a verdict comes back "real-over-budget" with no obvious cause, the memo recommends a separate trace-driven follow-up.
- Cross-browser / other scenarios.
- Updating the `/bench` page or homepage. Memo informs decisions; surface changes are separate.

## Architecture

One PR off latest `main`. Three sequential phases (mirrors PR #124 + PR #133):

| Phase | Action | Output |
|---|---|---|
| A | n=20 matrix re-run for `pretable + tanstack` × S2/hypothesis × {`filter-metadata`, `filter-text`}. | `status/milestones/2026-05-11-interaction-borderline-high-repeat.json` with mean / σ / min / median / max per (adapter, script). |
| B | (Skipped — no traces. Borderlines don't have a perf cliff to find.) | n/a |
| C | Memo with per-slice verdicts. | `docs/research/2026-05-11-interaction-borderline-perf-diagnostic.md` |

## Method details

### Phase A

```
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable,tanstack \
  --scenarios=S2 \
  --scripts=filter-metadata,filter-text \
  --scale=hypothesis \
  --repeats=20
```

2 adapters × 2 scripts × 20 repeats = 80 runs. Wall-clock ≈ 12–18 min.

### Per-slice verdicts

For **pretable filter-text** (over-budget check):

- Compute mean ± σ of `interaction_latency_ms` across 20 samples.
- If `mean + 2σ ≤ 16 ms` → `noise-within-budget`. The 17.7 ms n=3 reading was a bad-frame artifact; pretable comfortably clears the frame budget at higher repeats.
- If `mean − 2σ > 16 ms` → `real-over-budget`. Pretable's filter-text path is reliably over the single-frame budget; logged as a fix candidate.
- Otherwise (mean straddles 16 ms within 2σ) → `borderline-confirmed`. Within ±2σ of budget; not clearly over or under. Recommend a separate profiling pass.

For **tanstack vs pretable filter-metadata** (parity check):

- Compute means ± σ for both adapters.
- Run the standard 2σ test: gap is "real" iff `|mean_tanstack − mean_pretable| > 2 × max(σ_tanstack, σ_pretable)`.
- If real AND mean_tanstack < mean_pretable → `real-tanstack-faster` (a finding worth a homepage prose note).
- If real AND mean_tanstack > mean_pretable → `real-tanstack-slower` (the n=3 result was a tanstack outlier).
- Otherwise → `noise-tied`.

### Memo structure

`docs/research/2026-05-11-interaction-borderline-perf-diagnostic.md`:

- Summary (1–2 sentences per slice; verdicts up top).
- Context (the n=3 numbers from PR #131).
- Method (matrix command + statistical tests).
- High-repeat data (table per slice).
- Per-slice verdict (over-budget check + parity check).
- Interpretation (what each verdict implies for homepage prose).
- Recommendations (concrete next steps if any verdict is "real" or "borderline-confirmed").

Length target: 600–1200 words.

## Risks

- **Matrix runner flake.** PR #133 had the matrix exit at ~36% completion. If that recurs, the memo reports actual n per slice and applies the same tests on the smaller sample; with low σ (which is typical for interaction-latency_ms on this harness), even n=6-8 is enough for unambiguous verdicts.
- **Statistical edge case.** If pretable's filter-text mean lands at exactly 16 ms ± 1 ms σ, neither the under-budget nor the over-budget condition fires cleanly — that's the `borderline-confirmed` outcome. Recommend deeper investigation rather than overclaiming either way.
- **Tanstack settle-time confound.** The latency metric measures trigger-to-first-changed-frame, not full settle. PR #131 noted tanstack's filter-metadata settle (26.5 ms) is 1.6× slower than pretable's (16.7 ms). If a tanstack-faster verdict surfaces on latency alone, the memo should call out the settle gap as the offsetting cost so the homepage prose stays honest.

## Out of scope

- Trace capture (no perf cliff to chase; per-slice numbers and σ are the deliverable).
- Code changes.
- Bench-matrix sample-protocol updates.
- Homepage updates (separate editorial follow-up if a verdict warrants one).
