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
- `packages/layout-core`: variable-height row math and viewport planning
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
pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll --repeats=3
```

For focused runs that write real summaries and traces:

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=sort pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=filter-metadata pnpm bench:e2e -- --project=chromium
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=filter-text pnpm bench:e2e -- --project=chromium
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
- Treat `S2` wrapped-text scroll behavior as the primary proving slice.
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

Off-screen autosize and streaming updates are intentionally deferred as first-class proving targets. The current priority is to make the shared engine path stronger and more honest.

## Current Risks

- Scroll proof is now materially better than the earlier failing checkpoint. The latest repeated Chromium `S2/dev/scroll` runset at `status/runsets/2026-04-14t20-16-32-016z.hypotheses.json` satisfies both `H1` and `H3`, and the latest repeated Chromium `S2/hypothesis/scroll` runset at `status/runsets/2026-04-14t20-20-01-263z.hypotheses.json` also keeps both satisfied.
- Interaction proof is materially stronger on the current `dev` slice, but not uniformly clean:
  - the repeated Chromium `S2/dev` interaction runset at `status/runsets/2026-04-15t06-03-15-343z.hypotheses.json` satisfies `H7` (`filter-metadata`) and `H8` (`filter-text`)
  - the same runset leaves `H6` (`sort`) failing on worst-case repeats even though current medians stay inside the thresholds; one repeat hit `74.6ms` interaction latency
  - the remaining gap is promotion and variance control, not basic instrumentation: the interaction hypotheses still need a fresh larger-scale `hypothesis` rerun after the current sort variance is understood
- Current interaction evidence means the wedge now covers passive wrapped-text scroll and two local `S2` filter interactions on repeated Chromium `dev` runs. Sort is measured and generally favorable, but it is not yet stable enough to treat as proven under the current worst-case threshold discipline.
- The benchmark and playground are tighter now, but `@pretable/react/internal` is still an internal seam. It should keep absorbing prototype-specific composition until the public API is deliberate.
- Streaming is still architectural intent, not implemented evidence.

## Recommended Reading

- `docs/research/repo-memory.md`
- `docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- `docs/superpowers/plans/2026-04-12-wedge-first-prototype.md`
- `docs/superpowers/specs/2026-04-13-shared-react-renderer-design.md`
- `docs/superpowers/plans/2026-04-13-shared-react-renderer.md`
- `docs/superpowers/plans/2026-04-13-inspection-prototype-tightening.md`
