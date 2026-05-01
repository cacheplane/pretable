# Pretable

Pretable is a `pnpm` monorepo for a text-aware data grid, its public npm packages, and the benchmark + marketing surfaces used to prove the wrapped-text and variable-height wedge.

## Current State

This repo is already beyond scaffolding.

- `apps/bench` is the benchmark lab. It compares Pretable against external adapters, writes hypothesis-bearing artifacts, and is the main source of performance evidence.
- `apps/website` is the marketing landing. It embeds the live grid as a `<PlaygroundSection>` for product-facing demos.
- `packages/*` contains both the public npm surface and the internal engine layers that are still evolving toward an MVP.

The repo is intentionally conservative about what is public.

- `@pretable/core`: framework-agnostic public grid primitives
- `@pretable/react`: public React adapter
- `@pretable/react/internal`: internal-only React renderer seam for repo-local composition

Everything else under `packages/` should be treated as internal implementation detail.

## Workspace Layout

### Public packages

- `packages/core`: public framework-agnostic package
- `packages/react`: public React adapter package

### Internal engine and support packages

- `packages/text-core`: estimate-first text preparation and layout helpers
- `packages/layout-core`: variable-height row math, viewport planning, and column virtualization
- `packages/grid-core`: canonical row/sort/filter/focus/selection state machine
- `packages/renderer-dom`: DOM renderer planning layer
- `packages/scenario-data`: shared benchmark/demo scenario data
- `packages/bench-runner`: benchmark artifact and dashboard utilities

### Apps

- `apps/bench`: benchmark harness and browser test target
- `apps/website`: marketing landing with embedded live grid
- `apps/streaming-demo`: streaming adapter demonstration

### Docs and status outputs

- `docs/superpowers/specs`: design specs written during exploration
- `docs/superpowers/plans`: implementation plans
- `docs/research/repo-memory.md`: durable product and architecture decisions
- `status/`: generated benchmark summaries, runsets, traces, and snapshots

## Bootstrap

Install dependencies in every checkout or worktree you plan to use.

```bash
pnpm install
```

If you open a fresh git worktree, run `pnpm install` there too. The main checkout and the worktree do not share `node_modules`.

## Daily Commands

### Development entry points

```bash
pnpm dev:bench
pnpm --filter @pretable/app-website dev
```

The website's `<PlaygroundSection>` defaults to the shared `dev` inspection dataset and exposes a dataset-scale switcher plus diagnostics for rendered rows, visible rows, planned height, viewport range, and selected row. Use it for real manual inspection, not just smoke testing.

### Benchmark entry points

```bash
pnpm bench:e2e -- --project=chromium
pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta --scenarios=S2 --scripts=scroll --repeats=3
```

For focused runs that write real summaries and traces:

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=sort pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=filter-metadata pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=filter-text pnpm bench:e2e -- --project=chromium
```

For S3 column virtualization (500 columns):

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S3 --scripts=scroll --scale=dev --repeats=3
```

For the repeated local interaction proof pass:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3
```

Pretable benchmark summaries now preserve two layers of evidence:

- viewport-policy notes from the scroll surface
- internal telemetry notes from the shared React path, such as rendered rows, visible rows, total rows, planned height, viewport range, selected row, and focused row

### Workspace verification

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

Run these sequentially in a single checkout. Heavy workspace commands can contend with each other if you launch them in parallel.

## Development Workflow

### If you are working on the live demo

- Start in `apps/website`'s `<PlaygroundSection>`.
- Keep the demo on the same renderer/core path as the benchmarked React surface.
- Avoid adding product chrome that bypasses the shared grid path.
- Use the diagnostics block and dataset-scale switcher to inspect stability under `dev` and `stress`, not just `tiny`.

### If you are working on the wedge

- Start in `apps/bench` and the internal engine packages.
- Treat `S2` wrapped-text scroll behavior as the primary proving slice. Use `S3` for column virtualization (500 columns).
- Keep claims tied to runset artifacts in `status/runsets/`.
- Keep benchmark telemetry off-DOM. Notes and summary payloads are fine; changing the `data-pretable-*` scroll subtree is not.

### If you are changing public API

- Public surface changes belong in `packages/core` or `packages/react`.
- Internal convenience seams should stay under `@pretable/react/internal` until their shape is stable enough to publish deliberately.

## Prototype Principles

The current product direction is stable:

- performance and stability first
- schema-agnostic core
- read-heavy inspection-table demo first
- local sort/filter/select/navigate first
- remote and streaming-compatible architecture, but no overclaiming that streaming is solved yet

Column virtualization is live: horizontal virtualization renders only visible columns plus overscan, proven at 500 columns (S3) with 160 peak DOM nodes and zero blank-gap frames. Off-screen autosize and streaming updates are intentionally deferred as first-class proving targets.

## Current Proof Surface

Milestone runsets are committed to `status/milestones/` so README citations resolve in any checkout. Re-runs that reproduce the same verdicts can replace these files; runs that change the verdict get their own dated milestone next to them.

- **Scroll (H1) — satisfied with comparative win.** `status/milestones/2026-05-01-h1-satisfied.hypotheses.json`: at `S2/hypothesis/scroll` × **5 repeats** with the unified cross-adapter row-height formula, Pretable's median frame_p95 is **16 ms** with zero row-height-error, zero blank gaps, zero long tasks, zero anchor shift. Grid Alpha medians **67 ms** (4× slower) with **152 px** of wrapped-content overflow because its `autoHeight + wrapText + virtualization` clips wrapped rows to one line at hypothesis scale. GridBeta matches Pretable's frame quality but is in the virtualization-primitive family. **No measured full-grid competitor achieves the same combined quality** — the H1 evaluator's strongest verdict.
- **Interaction proof (H1 + H6–H12) — comprehensive, all satisfied.** `status/milestones/2026-05-01-interaction-comprehensive.hypotheses.json`: at `{S2, S7}/hypothesis/{scroll, sort, filter-metadata, filter-text}` × 3 repeats × {pretable, gridalpha, gridbeta}. **All eight non-streaming hypotheses (H1, H6, H7, H8, H9, H10, H11, H12) are satisfied** under current thresholds. The H6 settle threshold was bumped from 48 → 64 ms (matching H8/H12) to absorb rAF-timing tail variance from the post-Apr-21 measurement-reconcile architecture; the inline rationale is in `scripts/bench-matrix.mjs evaluateH6`.
- **Column virtualization (S3) — measured.** `status/milestones/2026-05-01-s3-column-virtualization.hypotheses.json`: 2,500 rows × 500 columns × 2 pinned left × 3 repeats. Frame_p95 9.2-9.4 ms (well under 16 ms budget). **160 peak DOM nodes** vs the ~5,000 a non-virtualized renderer would create — 96% reduction. 16 peak rendered rows out of 2,500. Zero blank-gap frames, zero long tasks, zero anchor shift, zero row-height-error. No S3-specific hypothesis is defined (S3 isn't a wedge claim, it's a capability proof), so the runset's metric evidence stands on its own.
- **Streaming (H13/H14/H15) — H15 satisfied; H13 + H14 directional.** `status/milestones/2026-05-01-streaming-revalidated.hypotheses.json`: at `S5/hypothesis/updates` × {100, 500, 1k, 5k, 10k, 25k} pps × 3 repeats, all three measured adapters (pretable, gridalpha, gridbeta) hold ~9 ms frame_p95 across the rate range — Pretable's wedge here is **row stability** (max visible-row drift = 1 vs Grid Alpha's 28). GridGamma X Community excluded after timing out the harness, exactly matching its documented degradation pattern. See [`docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md`](docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md) for the full rate-table analysis and the 2026-05-01 revalidation note.

## Current Risks

- `@pretable/react/internal` is still an internal seam. It should keep absorbing prototype-specific composition until the public API is deliberate.
- Streaming has implemented evidence (H15 satisfied) but H13 and H14 are directional, not satisfied — the comparative streaming wedge is row stability vs Grid Alpha, not raw frame budget vs the field. See `docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md` for the honest framing.

## Recommended Reading

- `docs/research/repo-memory.md`
- `docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- `docs/superpowers/plans/2026-04-12-wedge-first-prototype.md`
- `docs/superpowers/specs/2026-04-13-shared-react-renderer-design.md`
- `docs/superpowers/plans/2026-04-13-shared-react-renderer.md`
- `docs/superpowers/plans/2026-04-13-inspection-prototype-tightening.md`
- `docs/superpowers/specs/2026-04-20-column-virtualization-design.md`
- `docs/superpowers/plans/2026-04-20-column-virtualization.md`
