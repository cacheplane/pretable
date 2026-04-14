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

### Benchmark entry points

```bash
pnpm bench:e2e -- --project=chromium
pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta --scenarios=S2 --scripts=scroll --repeats=3
```

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

### If you are working on the wedge

- Start in `apps/bench` and the internal engine packages.
- Treat `S2` wrapped-text scroll behavior as the primary proving slice.
- Keep claims tied to runset artifacts in `status/runsets/`.

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

## Recommended Reading

- `docs/research/repo-memory.md`
- `docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- `docs/superpowers/plans/2026-04-12-wedge-first-prototype.md`
- `docs/superpowers/specs/2026-04-13-shared-react-renderer-design.md`
- `docs/superpowers/plans/2026-04-13-shared-react-renderer.md`
- `docs/superpowers/plans/2026-04-13-inspection-prototype-tightening.md`
