# Interaction Recomputation Reduction Design

Date: 2026-04-15

## Summary

Pretable now has a clean repeated Chromium `S2/dev` interaction proof surface, but it still misses the larger `S2/hypothesis` interaction bar for local sort and metadata filtering.

Current evidence on this branch:

- Repeated Chromium `S2/dev` interaction runset at [status/runsets/2026-04-16t00-16-36-271z.hypotheses.json](../../status/runsets/2026-04-16t00-16-36-271z.hypotheses.json):
  - `H6`: satisfied
  - `H7`: satisfied
  - `H8`: satisfied
- Repeated Chromium `S2/hypothesis` interaction runset at [status/runsets/2026-04-16t00-17-20-982z.hypotheses.json](../../status/runsets/2026-04-16t00-17-20-982z.hypotheses.json):
  - `H6`: failing
  - `H7`: failing
  - `H8`: satisfied

The important pattern is that these are latency misses, not stability failures. Blank gaps, anchor shift, row-height error, and selection/focus preservation remain controlled. The likely remaining cost is the shared synchronous row-model and render recomputation path, not a broken interaction flow.

The next phase should therefore focus on removing redundant sort/filter recomputation and duplicate emits in the shared path before attempting deeper algorithm changes.

## Problem

The branch fixed a real renderer-side churn source:

- redundant row-height remeasurement on pure sort reorder
- stale measured-height cache behavior on growth/shrink paths

That was enough to clean the repeated `dev` interaction family, but it did not solve the larger-scale latency problem.

Current artifact and code evidence suggest:

- `H6` and `H7` fail at `hypothesis` scale with latency around `58-67ms`
- `H8` stays satisfied under a looser threshold despite landing in a similar latency band
- telemetry for the failing slices still shows only `7` rendered rows and `3` visible rows
- the likely remaining cost therefore scales with total-row interaction work, not viewport rendering size

The main suspects are:

1. shared synchronous row-model recomputation in `grid-core`
2. immediate full render-snapshot rebuilds in `usePretableModel()`
3. duplicate state transitions or emits in the React interaction synchronization path, especially filter application

## Goals

- Reduce `H6` and `H7` latency at `hypothesis` scale without weakening hypothesis thresholds.
- Keep the fix in shared code rather than introducing benchmark-only shortcuts.
- Preserve the current stability wins:
  - zero blank gaps
  - zero anchor drift
  - zero row-height error
  - preserved selection/focus state
- Avoid regressing the now-clean `dev` interaction family.
- Preserve the benchmark DOM contract and current artifact semantics.

## Non-Goals

- Reworking the whole benchmark framework again.
- Relaxing `H6` or `H7` thresholds.
- Introducing new browsers or new scenario families in this phase.
- Replacing the current row model with a large architectural rewrite before duplicate-work cleanup is exhausted.
- Optimizing the playground separately from the benchmarked shared path.

## Observed Likely Root Cause

The most likely remaining cost is duplicated or overly broad recomputation on each interaction.

Relevant current code paths:

- [packages/grid-core/src/derived-rows.ts](/Users/blove/repos/pretable/packages/grid-core/src/derived-rows.ts)
- [packages/react/src/use-pretable.ts](/Users/blove/repos/pretable/packages/react/src/use-pretable.ts)
- [packages/react/src/internal/pretable-surface.tsx](/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx)

Why this is the best working hypothesis:

- the renderer no longer appears to be the dominant scale factor, because rendered-row counts stay flat
- the latency jump tracks total row counts (`750` to `3000`) rather than visible-row counts
- sort and metadata filter both fail in ways that suggest full visible-row derivation plus immediate render-snapshot rebuild
- the current filter sync path still clears filters and reapplies them, which is a plausible duplicate-emit source

This should be treated as a recomputation problem first, not as a “needs more virtualization” problem.

## Recommended Approach

Take a two-stage reduction pass.

### Stage 1: Eliminate Redundant Interaction Transitions

Focus on shared state churn first.

Questions to answer:

- Does one sort action produce more than one meaningful `grid` emit?
- Does one metadata filter action produce more than one meaningful `grid` emit?
- Does the current `interactionState` sync path force unnecessary clear-and-reapply behavior?
- Are equivalent sort/filter states being reapplied even when already current?

Likely code seams:

- [packages/react/src/internal/pretable-surface.tsx](/Users/blove/repos/pretable/.worktrees/codex-sort-variance-and-interaction-promotion/packages/react/src/internal/pretable-surface.tsx)
- [packages/grid-core/src/create-grid-core.ts](/Users/blove/repos/pretable/.worktrees/codex-sort-variance-and-interaction-promotion/packages/grid-core/src/create-grid-core.ts)

Expected outcome:

- one interaction should lead to one state transition chain, not a clear/reapply cascade

### Stage 2: Reduce Broad Rebuild Work

If duplicate emits are removed but latency still misses, then narrow the render/recompute path.

Questions to answer:

- Can `usePretableModel()` avoid rebuilding the DOM render snapshot more than once per meaningful interaction result?
- Can the row-model derivation avoid unnecessary work when only sort or only one filter changes?
- Are there memoization opportunities that are correct and do not violate the repo’s React guidance?

Likely code seams:

- [packages/react/src/use-pretable.ts](/Users/blove/repos/pretable/packages/react/src/use-pretable.ts)
- [packages/grid-core/src/derived-rows.ts](/Users/blove/repos/pretable/packages/grid-core/src/derived-rows.ts)
- [packages/renderer-dom/src/create-renderer.ts](/Users/blove/repos/pretable/packages/renderer-dom/src/create-renderer.ts) only if profiling proves repeated render-plan rebuild is still a large share

Expected outcome:

- interaction latency scales better with total row count without changing visible output semantics

## Preferred Order

1. Add focused tests that prove duplicate sort/filter application or unnecessary recomputation.
2. Remove redundant interaction transitions first.
3. Re-measure `H6` and `H7` at repeated `dev`.
4. If `dev` stays green, rerun `hypothesis`.
5. Only if larger-scale latency is still failing after duplicate-work removal should deeper row-model optimization begin.

This order is important because it keeps the next fix minimal and attributable.

## Design Constraints

- The benchmarked Pretable path must stay on the shared React surface.
- No benchmark-only “fast path” for sort/filter interactions.
- Any caching or memoization must be invalidated by real row/column/measurement changes.
- Selection and focus preservation remain required.
- Docs and artifact summaries must stay honest if the improvement is only partial.

## Verification Plan

Minimum verification for this phase:

- focused shared-path tests for the identified duplicate transition or recomputation seam
- repeated Chromium `S2/dev` interaction matrix:
  - `sort`
  - `filter-metadata`
  - `filter-text`
- repeated Chromium `S2/hypothesis` interaction matrix for the same three scripts

Success criteria for the phase:

- `H6` and `H7` improve at `hypothesis` scale without regressing `H8`
- no regression in stability metrics
- `dev` remains fully green

If the phase only improves one of `H6` or `H7`, that is still useful, but the checkpoint should state that clearly rather than framing it as full interaction proof.

## Risks

- Fixing duplicate emits but missing the larger row-model cost.
- Adding memoization that accidentally hides legitimate updates.
- Improving `sort` while regressing filter semantics or selection/focus continuity.
- Treating the current `H8` success as proof that the whole interaction family is “close enough.”

## Future Work Suggestions

If recomputation reduction works, the next high-value options are:

- row-model algorithm work for larger filtered/sorted sets
- a small timing-breakdown artifact only if attribution is still ambiguous
- broader environment validation only after Chromium `hypothesis` proof is cleaner
