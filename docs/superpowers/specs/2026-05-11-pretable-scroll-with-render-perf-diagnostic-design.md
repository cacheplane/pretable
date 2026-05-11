# Pretable `scroll-with-render` Perf Diagnostic Design

**Date:** 2026-05-11
**Status:** Draft (awaiting user review before plan)
**Predecessor:** [B2 follow-up #5a cell-renderer comparators (PR #130)](../../research/repo-memory.md); [B2 follow-up #1 perf-diag (PR #124)](./2026-05-09-b2-followup-perf-diagnostic-design.md) — same pattern reapplied

---

## Goal

Diagnose whether pretable's `scroll-with-render` frame p95 (16.4 ms in the n=3 PR #130 runset) is genuinely slower than `scroll-with-format` (10.2 ms) and `scroll-with-heavy-render` (10.3 ms), or whether the 6 ms gap is a low-sample artifact. Output is a research memo plus committed evidence — no code changes. If the gap is real, the memo proposes the cause and a future fix PR; if it's noise, the memo concludes that.

## Why

PR #130 captured (n=3 medians, Chromium S2/hypothesis):

| Script                     | pretable scroll p95 | DOM nodes peak | Notes                                              |
| -------------------------- | ------------------- | -------------- | -------------------------------------------------- |
| `scroll-with-format`       | 10.2 ms             | 98             | column.format set                                  |
| `scroll-with-render`       | **16.4 ms**         | 164            | column.render set (cheap JSX: 1 span)              |
| `scroll-with-heavy-render` | 10.3 ms             | 296            | column.render set (heavy JSX: 3 spans + className) |

Heavy render renders more DOM (296 nodes vs 164) yet measures faster than cheap render. Heavy and cheap share the same code path in `@pretable/react`'s `MemoizedCellContent` (the `column.render` branch); the only structural difference between them is the JSX shape returned. Format diverges (uses `column.format` instead).

Two competing hypotheses:

1. **Sampling noise.** n=3 means p95 is essentially max-of-3. A single slow frame in the cheap-render run could inflate the median across 3 repeats. Most likely outcome based on the PR #124 precedent (where a 1 ms gap dissolved at n=20).
2. **React-reconciliation cliff.** A single-text-child span (cheap) vs a multi-child span (heavy) hits different React reconciliation paths. Less likely but plausible — would manifest as a real and reproducible gap at higher repeats.

This investigation tightens the signal first, then profiles only if warranted.

## Non-goals

- **Fixing the gap.** Any code change to close the cheap-render path is a follow-up PR informed by this memo's verdict.
- **Compromising pretable's quality guarantees:** zero blank-gap frames, zero scroll-anchor backward shift, ≤1 px row-height error. Proposed fixes that erode these get marked "not worth it" regardless of speed gain.
- **Cross-browser data.** Chromium only, mirroring PR #130 / #124.
- **Other adapters.** This is pretable-internal; ag-grid / tanstack / mui cell-renderer numbers are not in scope.
- **A synthetic micro-benchmark.** The existing `apps/bench` matrix is the instrument.

## Architecture

One PR off latest `main`. Three sequential phases inside the PR (mirrors PR #124):

| Phase | Action                                                                                                                                      | Output                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A     | High-repeat (n=20) re-run of `pretable / S2 / hypothesis / {scroll-with-format, scroll-with-render, scroll-with-heavy-render}` on Chromium. | `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json` with mean / σ / min / median / max per script. |
| B     | If Phase A confirms both `cheap − format` AND `cheap − heavy` gaps are real (>2σ): capture one Playwright trace per script.                 | `status/traces/2026-05-11-pretable-scroll-with-{format,render,heavy-render}.trace.zip`                                |
| C     | Manual trace analysis (only if Phase B fires). Identify what cheap-render does differently.                                                 | `docs/research/2026-05-11-pretable-scroll-with-render-perf-diagnostic.md`                                             |

If Phase A shows the gap is noise (one or both pairs within 2σ), the memo concludes "noise; the n=3 cheap-render outlier was a sample artifact" and skips Phases B+C. The PR ships the high-repeat runset + a short negative-result memo.

## Method details

### Phase A

```
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable \
  --scenarios=S2 \
  --scripts=scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=20
```

3 scripts × 20 repeats = 60 runs. Wall-clock ≈ 8–12 min.

**Statistical test.** Compute mean and standard deviation of `scroll_frame_p95_ms` across the 20 samples per script. The gap is "real" if BOTH of these hold:

- `|mean_cheap − mean_format| > 2 × max(σ_cheap, σ_format)`
- `|mean_cheap − mean_heavy| > 2 × max(σ_cheap, σ_heavy)`

If only one pair shows "real" or both show noise, the differential isn't clean and Phase A is the verdict. If both pass, Phase B fires.

**Output file.** `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json` mirrors the shape of `2026-05-09-perf-diag-high-repeat.scroll.json` (PR #124's output) — one entry per script, sample array preserved for future re-analysis.

### Phase B (conditional)

Capture one Playwright trace per script in dev mode. The bench-app's existing trace wiring writes `.trace.zip` under `status/traces/` per run. Save the three traces (or fewer if file size is prohibitive — commit a flame-graph summary instead).

If trace capture fails (file format issues, harness errors), escalate BLOCKED. The memo can still ship with verdict "real but undiagnosed."

### Phase C (conditional)

Manual analysis. The trace viewer (Chrome DevTools or Playwright's `show-trace`) shows the steady-state scroll frame work. Look for:

- A code-path divergence between cheap and format (different React render branches, different reconciliation cost)
- A code-path divergence between cheap and heavy (the most surprising — same React code path, different JSX shape)
- Style recalculation or layout work attributable to the cheap-render's DOM shape

Memo records findings, leading hypothesis, and proposed fix(es) without implementing.

### Memo structure

`docs/research/2026-05-11-pretable-scroll-with-render-perf-diagnostic.md`:

```
# Pretable scroll-with-render perf diagnostic — 2026-05-11

## Summary
<1-2 sentences: gap real or noise; leading hypothesis if real>

## High-repeat data (n=20)
<table per script: mean, σ, min, median, max>

## Statistical verdict
<2σ comparisons shown; "real" only if both pairs pass>

## Trace findings (only if real)
- Cheap render hotspots:
- Heavy render hotspots:
- Format hotspots:
- Differential:

## Hypothesis for the gap (only if real)
<1-3 paragraphs>

## Proposed fixes (no code in this PR)
<options with expected delta + risk to quality wedge>

## Verdict
<ship a perf-fix PR / don't bother / need more data>
```

Length target: 500–1500 words. Same as PR #124's memo.

## Risks

- **Variance at hypothesis scale.** The cell-renderer scripts are scroll-shape and run for ~3 seconds. Per-frame timing variance can be 1-3 ms under normal local conditions. Even n=20 might not collapse the gap to a clean verdict if σ_cheap is high. Mitigation: report σ honestly and recommend n=50 follow-up if inconclusive.
- **Hardware noise.** Local Chromium on a busy machine produces noisier perf than a lab environment. Run with the laptop idle; document any unavoidable background load in the memo.
- **Cheap-render gap may be a sampling-noise + DOM-attribute interaction.** The `data-bench-render="cheap"` attribute is set on cheap; `data-bench-render="heavy"` plus more is set on heavy. If Chrome's style-invalidation cost differs for attribute count or className presence, the gap could be real but attributable to bench-instrumentation rather than pretable's render path. The memo should note this potential confound.
- **Manual trace analysis is bespoke.** No automated test confirms a memo's findings. Mitigation: commit the traces so a future reader can re-open them.

## Out of scope

- Code fixes: follow-up PR informed by the memo.
- Other browsers (Webkit, Firefox).
- Other scripts or scenarios.
- Updating the `/bench` page or homepage. This memo informs decisions; presentation changes are separate.
