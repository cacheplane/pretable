# Pretable

Pretable is a `pnpm` monorepo for a text-aware data grid, its public npm packages, and the benchmark/playground surfaces used to prove the wrapped-text and variable-height wedge.

## Current State

This repo is already beyond scaffolding.

- `apps/bench` is the benchmark lab. It compares Pretable against external adapters, writes hypothesis-bearing artifacts, and is the main source of performance evidence.
- `apps/playground` is the first product-facing prototype. It currently presents a read-heavy inspection table built on the same core path as the React renderer work.
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
- `apps/playground`: prototype inspection-table playground

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
pnpm dev:playground
```

The playground now defaults to the shared `dev` inspection dataset and exposes a local dataset-scale switcher plus diagnostics for rendered rows, visible rows, planned height, viewport range, and selected row. Use it for real manual inspection, not just smoke testing.

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

### If you are working on the prototype

- Start in `apps/playground`.
- Keep the playground on the same renderer/core path as the benchmarked React surface.
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

- Scroll proof: the latest repeated Chromium `S2/hypothesis/scroll` runset at `status/runsets/2026-04-20t23-48-22-840z.hypotheses.json` satisfies `H1` (composite scroll quality). No scroll regression from interaction work.
- Interaction proof is now clean at both `dev` and `hypothesis` scale:
  - the repeated `S2/dev` interaction runset at `status/runsets/2026-04-20t23-47-00-725z.hypotheses.json` satisfies `H6` (`sort`), `H7` (`filter-metadata`), and `H8` (`filter-text`) with max latency under 9ms
  - the repeated `S2/hypothesis` interaction runset at `status/runsets/2026-04-20t23-47-43-474z.hypotheses.json` also satisfies `H6`, `H7`, and `H8` with max latency under 9ms
  - the sort variance spike (~74.6ms) that originally motivated the interaction promotion roadmap is gone — likely resolved by earlier shared-path fixes (input recreation fix, post-mutation anchor accounting, row-height measurement churn reduction)
- Pinned-column scenario (S7) with 3 pinned left columns and variable-height multilingual content is registered and runnable across all four adapters. H9-H12 hypotheses mirror the S2 proof surface.
- Column virtualization proof (S3): 500 columns with 2 pinned left, fixed-height rows. Scroll runs show 160 peak DOM nodes (vs ~5000 without virtualization), 0 blank-gap frames, 0 long tasks. S1/S2/S7 scroll quality is unaffected by the CSS grid-to-absolute-positioning migration.

## Current Risks

- The benchmark and playground are tighter now, but `@pretable/react/internal` is still an internal seam. It should keep absorbing prototype-specific composition until the public API is deliberate.
- Streaming is still architectural intent, not implemented evidence.

## Recommended Reading

- `docs/research/repo-memory.md`
- `docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- `docs/superpowers/plans/2026-04-12-wedge-first-prototype.md`
- `docs/superpowers/specs/2026-04-13-shared-react-renderer-design.md`
- `docs/superpowers/plans/2026-04-13-shared-react-renderer.md`
- `docs/superpowers/plans/2026-04-13-inspection-prototype-tightening.md`
- `docs/superpowers/specs/2026-04-20-column-virtualization-design.md`
- `docs/superpowers/plans/2026-04-20-column-virtualization.md`
