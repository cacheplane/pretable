# Cloud Continuation Prompt

Use this prompt as the opening message for a new ChatGPT cloud coding session.

---

You are continuing active engineering work on the `pretable` repository.

## Repository And Branch

- Repository: `cacheplane/pretable`
- Primary branch to continue from: `main`
- The sort-variance and interaction-recomputation work has been merged to `main`; there is no longer an active `codex/sort-variance-and-interaction-promotion` branch.

## Immediate Working Rules

- Do not start by re-scaffolding or re-explaining the repo.
- Do not relax benchmark thresholds or redefine hypotheses to make failing results pass.
- Do not add benchmark-only shortcuts if the bottleneck is in shared code.
- Keep the benchmark and prototype paths aligned.
- Preserve the existing Pretable benchmark DOM contract.
- Use TDD for any behavior change.
- Use systematic debugging before proposing fixes.
- Prefer focused verification plus fresh benchmark artifacts over broad claims.
- Be explicit and honest about what is proven versus what is still mixed.

## What Has Already Been Built

This repo is already well beyond scaffolding.

### Architecture / Packages

- Public packages:
  - `packages/core`
  - `packages/react`
- Internal engine/support layers:
  - `packages/text-core`
  - `packages/layout-core`
  - `packages/grid-core`
  - `packages/renderer-dom`
  - `packages/scenario-data`
  - `packages/bench-runner`
- Apps:
  - `apps/bench`
  - `apps/playground`

### Prototype / Benchmark Status

- The playground is a real inspection-table prototype, not a placeholder.
- The benchmark lab is serious and writes hypothesis-bearing artifacts.
- Wrapped-text scroll stability is proven at hypothesis scale (H3).
- Interaction proof (sort, metadata filter, text filter) is now green at hypothesis scale (H6, H7, H8).
- The comparative scroll win vs a DOM competitor adapter (H1) is still directional, not satisfied.

## Most Important Current Docs To Read First

Read these before changing code:

1. [README.md](/README.md)
2. [docs/research/repo-memory.md](/docs/research/repo-memory.md)
3. [docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md](/docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md)

## What Was Just Fixed On Main

The interaction-recomputation-reduction phase shipped to `main`. In summary:

- `BenchApp` now memoizes `query` and the scenario dataset so telemetry-driven rerenders no longer rebuild 3000 row objects per interaction.
- `estimateRowHeight` in `renderer-dom` has a `columnsRef` fast path on the WeakMap cache, avoiding signature recomputation on the common case.
- `PretableAdapter` telemetry writes go through refs and direct `data-*` attrs so telemetry updates do not rerender the surface.
- `PretableSurface` batch-measures rows once per commit in a single `useLayoutEffect` over a ref `Map`, instead of per-ref-callback.
- `sortRows` specializes the all-numeric key path to avoid repeated `typeof` + `Intl.Collator` work.
- Scroll `maxSettleFrames` tightened to 3 now that settle is stable.

### Regressions Already Covered

Focused tests guard the shared-surface measurement behavior in:

- [packages/react/src/internal/__tests__/pretable-surface.test.tsx](/packages/react/src/internal/__tests__/pretable-surface.test.tsx)

Specifically:

- no remeasurement on pure sort reorder of unchanged tall wrapped rows
- remeasurement when the same row grows
- eviction when the same row shrinks
- same-height DOM-signature updates not causing permanent redundant remeasurement

The bench adapter also asserts that telemetry updates do not rerender the surface:

- [apps/bench/src/__tests__/pretable-adapter.test.tsx](/apps/bench/src/__tests__/pretable-adapter.test.tsx)

Do not accidentally remove that coverage.

## Latest Verified Benchmark Checkpoint

Freshest runset on `main` at the time of this handoff:

- [status/runsets/2026-04-16t04-32-37-851z.hypotheses.json](/status/runsets/2026-04-16t04-32-37-851z.hypotheses.json)

Hypothesis family state:

- `H1` (wrapped-text scroll win vs DOM competitor): **directional** — Pretable itself now has clean S2 scroll measurements (no blank gaps, no long tasks) at hypothesis scale, but the required relative win against a DOM competitor adapter is still unmeasured.
- `H3` (variable-height scrolling stability): **satisfied** at hypothesis scale.
- `H5` (artifact pipeline): **satisfied**.
- `H6` (wrapped-text local sorting): **satisfied** at hypothesis scale.
- `H7` (metadata filtering): **satisfied** at hypothesis scale.
- `H8` (wrapped-text primary-column filtering): **satisfied** at hypothesis scale.

### Representative Current Metrics

From the latest `hypothesis` run:

- Scroll S2 (Pretable only): `scroll_frame_p95_ms` ~25ms, 0 blank gaps, 0 long tasks, 0 row-height error px.
- Sort / filter-metadata / filter-text: `settle_duration_ms` medians ~17–18ms (threshold 48ms), 4x margin under threshold, 3000-row result set preserved.

## Most Likely Remaining Work

The remaining open hypothesis is `H1`: comparative wrapped-text scroll performance versus a DOM competitor.

Pretable's own scroll evidence is clean at hypothesis scale. What is missing is a competitor baseline for a head-to-head claim. The bench already has `AGGridAdapter` and `TanStackAdapter`; the gap is running them through the same S2 hypothesis-scale scroll script and producing a comparable hypothesis artifact.

Main suspected areas to inspect if the comparison is not already parameterized:

- [scripts/bench-matrix.mjs](/scripts/bench-matrix.mjs) — does it accept multi-adapter runs for scroll at `hypothesis` scale?
- [packages/bench-runner/src/index.ts](/packages/bench-runner/src/index.ts) — hypothesis evaluation for H1 relative comparison.
- [apps/bench/src/ag-grid-adapter.tsx](/apps/bench/src/ag-grid-adapter.tsx) and [apps/bench/src/tanstack-adapter.tsx](/apps/bench/src/tanstack-adapter.tsx) — competitor harness correctness at hypothesis scale.

## Recommended Next Slice

### Stage 1: Produce A Clean Competitor Baseline

Run at least one competitor adapter (AG Grid or TanStack Virtual) through the S2 scroll script at `hypothesis` scale and capture the baseline metrics. Do not tune thresholds to make `H1` pass; just measure honestly and write the artifact.

### Stage 2: Close Or Redefine H1

Once a clean competitor baseline exists, either:

- confirm `H1` is satisfied with the current Pretable metrics, or
- document what is still blocking it and which dimension needs work (frame pacing, DOM node cost, settle behavior, etc.).

## What To Avoid

- Do not claim `H1` is proven without a fresh competitor artifact.
- Do not trust only one rerun if results wobble.
- Do not optimize only the benchmark adapter if the cause is in shared code.
- Do not remove the current row-measurement cache regressions.
- Do not break the current benchmark DOM contract.
- Do not convert honest latency misses into threshold changes without explicit approval.

## Verification Expectations

For the next slice, any meaningful change should at minimum rerun:

```bash
pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom
pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3
```

And any final summary should include:

- exact runset path(s)
- `H1` / `H3` / `H6` / `H7` / `H8` status
- whether the latest result is a latency miss or a stability miss
- what remains unresolved

## Short Handoff Summary

You are inheriting `main` where:

- row-height measurement churn is fixed in shared code
- redundant grid-core emits are short-circuited
- bench adapter telemetry no longer rerenders the surface
- sort, metadata filter, and text filter are green at hypothesis scale
- the remaining open question is the competitor comparison for wrapped-text scroll (`H1`)

Continue from that point. Do not restart the investigation from zero.

---

Suggested first instruction to yourself after checkout:

"Read the recomputation-reduction spec and the latest runset, then plan the smallest credible competitor-baseline bench run that would either close H1 or cleanly show what is still missing. Do not touch shared code before the baseline exists."
