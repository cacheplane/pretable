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

- [packages/react/src/internal/**tests**/pretable-surface.test.tsx](/packages/react/src/internal/__tests__/pretable-surface.test.tsx)

Specifically:

- no remeasurement on pure sort reorder of unchanged tall wrapped rows
- remeasurement when the same row grows
- eviction when the same row shrinks
- same-height DOM-signature updates not causing permanent redundant remeasurement

The bench adapter also asserts that telemetry updates do not rerender the surface:

- [apps/bench/src/**tests**/pretable-adapter.test.tsx](/apps/bench/src/__tests__/pretable-adapter.test.tsx)

Do not accidentally remove that coverage.

## Latest Verified Benchmark Checkpoint

Two runsets on `main` together cover the full hypothesis family at hypothesis scale. `bench:matrix` errors on unsupported competitor×interaction combinations, so the comparator scroll run and the Pretable-only interaction run are written separately.

- Competitor scroll baseline: [status/runsets/2026-04-16t16-52-55-622z.hypotheses.json](/status/runsets/2026-04-16t16-52-55-622z.hypotheses.json)
- Pretable interaction family: [status/runsets/2026-04-16t04-32-37-851z.hypotheses.json](/status/runsets/2026-04-16t04-32-37-851z.hypotheses.json)

Hypothesis family state:

- `H1` (wrapped-text scroll win vs DOM competitor): **satisfied** — Pretable `scroll_frame_p95_ms` 24.9ms vs AG Grid 41.6ms (~40% margin, past the 25% bar), TanStack 24.8ms. 0 blank gaps and 0 long tasks across all three.
- `H3` (variable-height scrolling stability): **satisfied** at hypothesis scale.
- `H5` (artifact pipeline): **satisfied**.
- `H6` (wrapped-text local sorting): **satisfied** at hypothesis scale.
- `H7` (metadata filtering): **satisfied** at hypothesis scale.
- `H8` (wrapped-text primary-column filtering): **satisfied** at hypothesis scale.

### Representative Current Metrics

From the latest `hypothesis` runs:

- Scroll S2 `scroll_frame_p95_ms` medians: Pretable 24.9ms, AG Grid 41.6ms, TanStack 24.8ms. 0 blank gaps, 0 long tasks for all three adapters.
- DOM peak nodes: Pretable 540, TanStack 540, AG Grid 657.
- Sort / filter-metadata / filter-text: `settle_duration_ms` medians ~17–18ms (threshold 48ms), 4x margin under threshold, 3000-row result set preserved.

## What Is Actually Open

The hypothesis family is green at hypothesis scale against the current comparator set. There is no single forced next slice from the hypothesis tracker.

Plausible next directions (each requires its own scoping):

- Broaden the H1 comparator set (other full-grid products) if you want a wider comparative claim.
- Harden the bench-matrix so unsupported adapter×script pairs emit an `unsupported` summary instead of erroring, so a single command can produce one canonical artifact.
- Begin work on the next hypothesis block (remote / streaming data, off-screen autosize, selection + keyboard cuts) following the existing spec cadence under `docs/superpowers/specs/`.
- Pull the proven engine behavior into more playground-visible product surface.

## What To Avoid

- Do not trust only one rerun if results wobble.
- Do not optimize only the benchmark adapter if the cause is in shared code.
- Do not remove the current row-measurement cache regressions.
- Do not break the current benchmark DOM contract.
- Do not convert honest latency misses into threshold changes without explicit approval.
- Do not reopen an already-satisfied hypothesis without a concrete reproducer.

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
- the wrapped-text scroll comparison against AG Grid and TanStack is satisfied at hypothesis scale

Continue from that point. Do not restart the investigation from zero.

---

Suggested first instruction to yourself after checkout:

"Read the two latest runsets and confirm the hypothesis family is still green. Then pick one of the open next directions with explicit scope before touching shared code."
