# Pretable Wrapped-Text Filter Perf Diagnostic Design

**Date:** 2026-05-13
**Status:** Draft (awaiting user review before plan)
**Predecessors:** [PR #134 interaction borderline diagnostic](../../research/repo-memory.md), [PR #141 editorial follow-up](../../research/repo-memory.md). Same pattern as [PR #124 perf-diag](./2026-05-09-b2-followup-perf-diagnostic-design.md) + [PR #133 scroll-with-render perf-diag](./2026-05-11-pretable-scroll-with-render-perf-diagnostic-design.md).

---

## Goal

Identify the cause of pretable's three interaction scripts (sort, filter-metadata, filter-text) reliably landing 1–2 ms over the 16 ms single-frame budget on Chromium S2/hypothesis at n=20. Output is a research memo with leading hypothesis + proposed fixes. If profiling surfaces a single-cause hotspot with a low-risk fix, the fix ships in the same PR; otherwise the memo queues a separate fix PR.

## Why

PR #134's high-repeat verdict:

| Script | mean (ms) | σ (ms) | Budget |
| --- | --- | --- | --- |
| sort | 17.10 | 1.83 | ≤ 16 |
| filter-metadata | 17.51 | 2.44 | ≤ 16 |
| filter-text | 16.79 | 0.31 | ≤ 16 |

All three reliably over the single-frame budget. Pretable is still 2–3.5× faster than every measured comparator, so the homepage narrative is intact (post PR #141's editorial follow-up). But the budget-miss is a real fact and there's likely a shared root cause across all three scripts — the wrapped-text filter / sort pipeline runs synchronously in pretable's React render, blocking the frame.

Code structure (from initial reading):

- `packages/grid-core/src/derived-rows.ts`: `deriveVisibleRows({ columns, filters, rows, sort })` does `resolveFilters` + `rows.filter(matchesFilters)` + `sortRows`. For 3000 rows with wrapped-text columns this is non-trivial.
- `packages/react/src/use-pretable.ts` + `pretable-surface.tsx`: trigger sort/filter via grid API → state update → React re-render → derive + virtualize + DOM update.

The 17 ms p95 is the whole trigger-to-first-changed-frame window. The derivation cost is one chunk; React reconciliation + virtualization are others. Profiling will name which dominates.

## Non-goals

- Cross-browser data (Chromium only, mirrors all prior B2 work).
- Synthetic micro-benchmarks. Use `apps/bench` matrix as the measurement instrument.
- Cross-script profiling (one trace per script). filter-text first; the memo extrapolates.
- Changing thresholds in `scripts/bench-matrix.mjs`. Status verdicts unchanged.
- Touching public-API surface. Any fix targets internal grid-core / react implementation.
- Tier 1 backlog (theming, AI integrations, docs).

## Architecture

Three sequential phases inside one PR. A conditional fourth phase (Phase D) handles the fix-if-easy decision.

### Phase A — Trace capture

Capture one Playwright trace for `pretable / S2 / hypothesis / filter-text`. The matrix runner can be coerced into capturing traces via its existing test harness; alternatively, run the Playwright spec directly with `PRETABLE_BENCH_*` env vars and `PLAYWRIGHT_TRACE=on`.

```
PRETABLE_BENCH_ADAPTER=pretable \
PRETABLE_BENCH_SCENARIO=S2 \
PRETABLE_BENCH_SCALE=hypothesis \
PRETABLE_BENCH_SCRIPT=filter-text \
PLAYWRIGHT_TRACE=on \
pnpm --filter @pretable/app-bench exec playwright test --workers=1
```

Trace file location: `apps/bench/test-results/*.zip` (or wherever the playwright config writes them). Copy + rename to `status/traces/2026-05-13-pretable-filter-text-perf.trace.zip`.

**Size budget:** 5–25 MB. If >25 MB, see "Trace size handling" below.

### Phase B — Trace analysis

Open via `pnpm exec playwright show-trace status/traces/2026-05-13-pretable-filter-text-perf.trace.zip`. The Performance / Trace view shows the steady-state interaction window.

Trigger-to-first-changed-frame window:

1. Click on filter input (or programmatic event dispatch) — `trigger()` callback in `measureBenchInteractionRun`.
2. React state update → re-render.
3. `deriveVisibleRows` runs → produces new filtered+sorted row list.
4. Virtualized list re-renders the visible window with the new list.
5. DOM mutations → paint → first changed frame.

For each long scripting task in the window:

- Note the duration (ms).
- Note the top-of-stack function name.
- Note which phase it's in (derivation / reconciliation / virtualization / DOM update).

The differential vs `scroll` (9.07 ms p95, well under budget) is the key: scroll doesn't run `deriveVisibleRows` on every frame, only on initial render. Interaction triggers a full re-derive. That's the likely difference.

### Phase C — Memo

`docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md`:

```
# Pretable wrapped-text filter perf diagnostic — 2026-05-13

## Summary
<1-2 sentences identifying the leading hypothesis>

## Context
- PR #134's n=20 verdicts (cite numbers).
- Code structure summary (deriveVisibleRows + React render).

## Method
- Trace captured at `status/traces/...`.
- Analysis: which scripting tasks dominate the trigger-to-first-frame window.

## Trace findings
- Longest scripting tasks with durations + function names + phase classification.
- Specific call-stack snippets for the hotspot(s).

## Hypothesis for the gap
- Leading cause (e.g., "deriveVisibleRows takes 8 ms; the rest is React reconciliation and virtualization").
- Why the other two scripts (sort, filter-metadata) likely share this cause.

## Proposed fixes
- One row per candidate: description, expected delta, risk, complexity.

## Verdict
- "Fix shipped in this PR — <X>" / "Fix deferred to follow-up PR — <reasoning>".
```

### Phase D (conditional) — Ship a fix

Ship the fix only if ALL of these hold:

1. **One obvious code change.** Single function or single file. No cross-cutting refactor.
2. **Doesn't touch quality wedge.** Zero blank gaps, anchor stability, ≤1 px row-height fidelity must all stay intact.
3. **Re-run matrix confirms the delta.** Pretable filter-text n=20 mean must move at least 2 ms lower with the fix in place, AND comparators' relative ratios stay 2-3× away from pretable.
4. **No public-API change.** Internal-only edit.

If any of these fail, the memo lists the candidate but the fix is queued to a separate PR. Document the deferral in Phase C's "Verdict" section.

### Trace size handling

If the trace exceeds 25 MB:

- View locally with `playwright show-trace`.
- Capture screenshots of the Performance panel (steady-state scroll window).
- Save under `docs/research/2026-05-13-perf-diag-traces/`.
- Note the local trace path in the memo without committing the binary.

### Out-of-scope follow-ups

- **Same-cause re-profile for sort + filter-metadata.** If filter-text's hotspot is `deriveVisibleRows`, the other two scripts should share the cause. The memo notes this; a fix PR can verify with focused matrix runs.
- **Stochastic-variance investigation** for filter-metadata. PR #134 noted σ = 2.44 ms — much wider than filter-text's 0.31 ms. Could be initial-scroll-position dependence or row-selection state. Logged as a follow-up.
- **`/bench` page hypothetical-fix-applied projection.** Out of scope; informational only.

## Risks

- **Trace doesn't surface a single dominant cause.** If the budget is consumed by many small contributions (React reconciliation across many cells, virtualization overhead, DOM mutations), there's no single "fix it here" answer. The memo records this honestly: verdict becomes "real-but-distributed; no single-cause hotspot; over-budget reflects 60Hz frame cost of full filter-rederive at this dataset size."
- **Matrix-runner flake during Phase D verification.** Already well-documented; document actual sample count.
- **Quality regression on a fix.** Phase D's gate condition #2 is explicit: any quality regression kills the fix. Verifying requires re-running the matrix's scroll + interaction scripts and confirming `blank_gap_frames`, `scroll_anchor_shift_backward_p95_px`, `row_height_error_p95_px` stay at their existing values.
- **Public-API leak.** Phase D restricts to internal-only edits. If a fix would need to expose a new option (`autoBatchFilters: true`, etc.), the memo proposes it and defers to a follow-up PR for the design conversation.

## Test plan

- **Pre-fix:** matrix n=20 numbers as a baseline (already captured in PR #134 + PR #141; no new run needed unless the trace capture goes through the matrix path).
- **Trace analysis:** manual review; no automated check.
- **Post-fix (if Phase D fires):** re-run pretable-only matrix at n=20 for filter-text + (sort, filter-metadata) to confirm latency delta. Confirm `blank_gap_frames`, `scroll_anchor_shift_backward_p95_px`, `row_height_error_p95_px` unchanged.
- **Repo-wide:** `pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format` clean.
