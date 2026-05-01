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
pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll --repeats=3
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

- **Scroll (H1) — satisfied with comparative win.** `status/milestones/2026-05-01-h1-satisfied.hypotheses.json`: at `S2/hypothesis/scroll` × 3 repeats, Pretable's frame_p95 is 9.3 ms with zero row-height-error, zero blank gaps, zero long tasks, zero anchor shift. AG Grid is 42.5 ms with 153 px row-height-error. TanStack matches Pretable's frame quality but is in the virtualization-primitive family. **No measured full-grid competitor achieves the same combined quality** — the H1 evaluator's strongest verdict.
- **Streaming (H13/H14/H15) — H15 satisfied; H13 + H14 directional.** `status/milestones/2026-05-01-streaming-revalidated.hypotheses.json`: at `S5/hypothesis/updates` × {100, 500, 1k, 5k, 10k, 25k} pps × 3 repeats, all three measured adapters (pretable, ag-grid, tanstack) hold ~9 ms frame_p95 across the rate range — Pretable's wedge here is **row stability** (max visible-row drift = 1 vs AG Grid's 28). MUI X Community excluded after timing out the harness, exactly matching its documented degradation pattern. See [`docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md`](docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md) for the full rate-table analysis and the 2026-05-01 revalidation note.
- **Interaction (H6/H7/H8) — historical proof.** Sort, metadata-filter, and text-filter all passed at `S2/hypothesis` scale on 2026-04-20 with max latency under 9 ms. Those runsets are gitignored; H6/H7/H8 should be re-run and a milestone written when interaction work next changes.
- **Pinned-column scenario (S7) — registered.** 40 columns, 3 pinned left, variable-height multilingual content, runnable across all four adapters. H9–H12 mirror H1 and H6–H8 for S7. No current milestone runset committed.
- **Column virtualization (S3) — historical proof.** 500 columns with 2 pinned left, fixed-height rows. Earlier scroll runs showed 160 peak DOM nodes (vs ~5000 without virtualization), 0 blank-gap frames, 0 long tasks. No current milestone runset committed.

## Current Risks

- `@pretable/react/internal` is still an internal seam. It should keep absorbing prototype-specific composition until the public API is deliberate.
- Streaming has implemented evidence (H15 satisfied) but H13 and H14 are directional, not satisfied — the comparative streaming wedge is row stability vs AG Grid, not raw frame budget vs the field. See `docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md` for the honest framing.
- H6/H7/H8 and S7's H9–H12 do not currently have committed milestone runsets — they were last verified on 2026-04-20 with gitignored runsets that no longer exist on disk.

## Recommended Reading

- `docs/research/repo-memory.md`
- `docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- `docs/superpowers/plans/2026-04-12-wedge-first-prototype.md`
- `docs/superpowers/specs/2026-04-13-shared-react-renderer-design.md`
- `docs/superpowers/plans/2026-04-13-shared-react-renderer.md`
- `docs/superpowers/plans/2026-04-13-inspection-prototype-tightening.md`
- `docs/superpowers/specs/2026-04-20-column-virtualization-design.md`
- `docs/superpowers/plans/2026-04-20-column-virtualization.md`
