# Cloud Continuation Prompt

Use this prompt as the opening message for a new ChatGPT cloud coding session.

---

You are continuing active engineering work on the `pretable` repository.

## Repository And Branch

- Repository: `cacheplane/pretable`
- Primary branch to continue from: `codex/sort-variance-and-interaction-promotion`
- The branch has already been pushed to `origin`
- Remote branch URL for PR creation if needed later:
  - [codex/sort-variance-and-interaction-promotion](https://github.com/cacheplane/pretable/pull/new/codex/sort-variance-and-interaction-promotion)

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
- Wrapped-text scroll proof is already credible.
- Local interaction proof on repeated Chromium `dev` is now green.
- Larger `hypothesis`-scale interaction proof is still mixed.

## Most Important Current Docs To Read First

Read these before changing code:

1. [README.md](/Users/blove/repos/pretable/README.md)
2. [docs/research/repo-memory.md](/Users/blove/repos/pretable/docs/research/repo-memory.md)
3. [docs/superpowers/specs/2026-04-15-sort-variance-and-interaction-promotion-design.md](/Users/blove/repos/pretable/docs/superpowers/specs/2026-04-15-sort-variance-and-interaction-promotion-design.md)
4. [docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md](/Users/blove/repos/pretable/docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md)

## What Was Just Fixed On This Branch

The branch recently fixed a real shared React surface problem around row-height measurement churn during sort/filter interactions.

### Files Touched

- [packages/react/src/internal/pretable-surface.tsx](/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx)
- [packages/react/src/internal/__tests__/pretable-surface.test.tsx](/Users/blove/repos/pretable/packages/react/src/internal/__tests__/pretable-surface.test.tsx)
- [README.md](/Users/blove/repos/pretable/README.md)
- [docs/research/repo-memory.md](/Users/blove/repos/pretable/docs/research/repo-memory.md)

### Behavior That Exists Now

The shared React surface now:

- skips remeasurement when:
  - the cached measured height is already applied
  - and the rendered row DOM signature is unchanged
- refreshes the cached measurement key when the row rerenders with the same measured height but a changed DOM signature
- evicts stale tall cached heights when the same row later shrinks back to default-height content

### Regressions Already Covered

The focused test file currently covers:

- no remeasurement on pure sort reorder of unchanged tall wrapped rows
- remeasurement when the same row grows
- eviction when the same row shrinks
- same-height DOM-signature updates not causing permanent redundant remeasurement

Do not accidentally remove that coverage.

## Latest Verified Benchmark Checkpoint

These were the latest fresh reruns on the branch when this handoff prompt was written.

### Repeated Chromium `dev` interaction family

Artifact:

- [status/runsets/2026-04-16t00-16-36-271z.hypotheses.json](/Users/blove/repos/pretable/status/runsets/2026-04-16t00-16-36-271z.hypotheses.json)

State:

- `H6`: satisfied
- `H7`: satisfied
- `H8`: satisfied

Interpretation:

- local `dev` interaction proof is now clean

### Repeated Chromium `hypothesis` interaction family

Artifact:

- [status/runsets/2026-04-16t00-17-20-982z.hypotheses.json](/Users/blove/repos/pretable/status/runsets/2026-04-16t00-17-20-982z.hypotheses.json)

State:

- `H6`: failing
- `H7`: failing
- `H8`: satisfied

Important nuance:

- these are latency misses, not stability failures
- blank gaps remain controlled
- anchor shift remains controlled
- row-height error remains controlled
- selection and focus preservation remain controlled

### Representative Current Metrics From The Latest `hypothesis` Run

From the latest current-HEAD rerun at [status/runsets/2026-04-16t00-17-20-982z.hypotheses.json](/Users/blove/repos/pretable/status/runsets/2026-04-16t00-17-20-982z.hypotheses.json):

- `H6` sort:
  - interaction latency median: about `66.7ms`
  - result row count: `3000`
  - blank gaps: `0`
  - anchor shift: `0`
  - row-height error: `0`
- `H7` metadata filter:
  - interaction latency median: about `66.7ms`
  - result row count: `750`
  - blank gaps: `0`
  - anchor shift: `0`
  - row-height error: `0`
- `H8` wrapped-text primary-column filter:
  - still satisfied under the current thresholds

## Most Likely Remaining Root Cause

The remaining issue does not currently look like a stability or measurement-correction bug.

It most likely comes from shared synchronous row-model and render recomputation cost at larger scale.

Main suspected areas:

- [packages/grid-core/src/derived-rows.ts](/Users/blove/repos/pretable/packages/grid-core/src/derived-rows.ts)
- [packages/grid-core/src/create-grid-core.ts](/Users/blove/repos/pretable/packages/grid-core/src/create-grid-core.ts)
- [packages/react/src/use-pretable.ts](/Users/blove/repos/pretable/packages/react/src/use-pretable.ts)
- [packages/react/src/internal/pretable-surface.tsx](/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx)

Working hypothesis:

- `deriveVisibleRows()` does broad scan/filter/sort work on the whole source set
- `usePretableModel()` rebuilds the render snapshot immediately from the resulting snapshot
- sort and filter interactions may still produce redundant emits or duplicate recomputation
- the filter synchronization path in `PretableSurface` may still be a duplicate-work source because it clears filters and reapplies them

## Recommended Next Slice

Do not jump straight to a big row-model rewrite.

Recommended next phase:

### Stage 1: Remove Redundant Interaction Transitions

Investigate and reduce duplicate state transitions or duplicate emits for:

- sort
- metadata filter

Most likely places to inspect:

- `packages/react/src/internal/pretable-surface.tsx`
- `packages/grid-core/src/create-grid-core.ts`

Questions to answer:

- does one sort action cause more than one meaningful emit?
- does one metadata filter action cause more than one meaningful emit?
- does `clearFilters()` plus reapply create an avoidable extra recomputation path?
- are equivalent sort/filter states being applied even when already current?

### Stage 2: Narrow Broad Rebuild Work

Only after duplicate transitions are removed:

- inspect whether `usePretableModel()` and row derivation still do more work than necessary per interaction
- then decide if deeper row-model optimization is justified

## Current Design Spec For The Next Phase

Read this spec before implementing the next slice:

- [docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md](/Users/blove/repos/pretable/docs/superpowers/specs/2026-04-15-interaction-recomputation-reduction-design.md)

That spec already captures:

- the current checkpoint
- the remaining likely bottleneck
- the recommended order of attack
- what not to do

## What To Avoid

- Do not claim the larger interaction family is proven.
- Do not trust only one rerun if results wobble.
- Do not optimize only the benchmark adapter if the cause is in shared code.
- Do not remove the current row-measurement cache regressions.
- Do not break the current benchmark DOM contract.
- Do not convert honest latency misses into threshold changes without explicit approval.

## Verification Expectations

For the next slice, any meaningful change should at minimum rerun:

```bash
pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3
```

And any final summary should include:

- exact runset path(s)
- `H6` / `H7` / `H8` status
- whether the latest result is a latency miss or a stability miss
- what remains unresolved

## If You Need A Good Starting Point

Start with:

1. read the recomputation-reduction spec
2. inspect `PretableSurface` interaction synchronization and `create-grid-core` emit behavior
3. add one narrowly targeted failing test for redundant sort/filter transition or duplicate emit behavior
4. only then change production code

## Short Handoff Summary

You are inheriting a branch where:

- row-height measurement churn was already fixed in shared code
- `dev` interaction proof is green
- `hypothesis` interaction proof still fails for sort and metadata filtering
- the remaining likely problem is duplicate or overly broad shared recomputation, not viewport instability

Continue from that point. Do not restart the investigation from zero.

---

Suggested first instruction to yourself after checkout:

“Read the recomputation-reduction spec and inspect the shared sort/filter emit path before changing code. Then write one failing test that proves duplicate interaction recomputation or duplicate state application.”
