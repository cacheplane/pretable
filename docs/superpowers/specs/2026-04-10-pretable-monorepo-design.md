# Pretable Monorepo Design

**Date:** 2026-04-10

## Goal

Create a modern `pnpm` monorepo for Pretable that supports:
- two publishable npm packages from day one
- internal engine and benchmark packages that can evolve without becoming part of the public contract
- in-repo benchmark and playground apps aligned with the attached product spec and benchmark plan

## Scope

This design covers repository structure, tooling, package boundaries, and initial bootstrap scope for the monorepo. It does not define the internal runtime behavior of the grid engine beyond package ownership and layering.

## Context

The attached spec and benchmark plan define Pretable as a benchmark-driven grid project with:
- a public framework-agnostic core
- a separate React package
- internal text, layout, renderer, and benchmark infrastructure
- `bench` and `playground` apps living in the same repository

The user clarified the following decisions during brainstorming:
- use a modern `pnpm` monorepo instead of Nx
- keep `bench` and `playground` in the same repo from day one
- ship only the public data grid library initially
- expose a public framework-agnostic core plus a separate React package
- use package names `@pretable/core` and `@pretable/react`
- use the superpowers workflow for brainstorming, spec, and subagents

Reference inputs:
- `/Users/blove/Downloads/precomputed-grid-spec.md`
- `/Users/blove/Downloads/benchmark-plan.yaml`

## Recommended Approach

Use a plain `pnpm` workspace as the monorepo foundation. Avoid Nx in the initial scaffold because the primary hard requirements are npm publishability, internal package flexibility, and a low-friction repo shape that matches the spec directly. Defer task-graph tooling such as Turborepo unless build complexity justifies it later.

## Repo Shape

```text
apps/
  bench/
  playground/
packages/
  core/
  react/
  scenario-data/
  text-core/
  layout-core/
  grid-core/
  renderer-dom/
  bench-runner/
docs/
  spec/
  research/
status/
  traces/
  snapshots/
```

## Tooling

Use the following baseline stack:
- `pnpm` workspaces for package management
- TypeScript with project references across packages and apps
- `tsup` for library builds in `@pretable/core` and `@pretable/react`
- Vite for `apps/bench` and `apps/playground`
- Vitest for unit tests
- Playwright for benchmark automation and browser checks
- ESLint with a modern TypeScript setup
- Prettier-compatible formatting scripts
- Changesets for versioning and npm publishing

This stack keeps public library publishing straightforward while supporting the benchmark-first development loop described in the product documents.

## Package Boundaries

### Public packages

#### `@pretable/core`

Responsibility:
- framework-agnostic public grid surface
- stable exported types
- top-level creation APIs and shared model interfaces

Constraints:
- may depend on internal workspace packages
- defines the public contract that external users consume directly or indirectly

#### `@pretable/react`

Responsibility:
- thin React adapter over `@pretable/core`
- React components, hooks, and lifecycle glue

Constraints:
- depends on `@pretable/core`
- should remain narrow and avoid owning engine logic

### Internal packages

#### `@pretable-internal/text-core`

Responsibility:
- text preparation and text layout experiments

#### `@pretable-internal/layout-core`

Responsibility:
- range extraction, prefix-sum data structures, scroll math, stretch mapping

#### `@pretable-internal/grid-core`

Responsibility:
- scheduler, state machine, cache invalidation, update pipeline

#### `@pretable-internal/renderer-dom`

Responsibility:
- imperative pooled DOM rendering layer

#### `@pretable-internal/scenario-data`

Responsibility:
- seeded datasets, corpora, and scenario fixtures

#### `@pretable-internal/bench-runner`

Responsibility:
- benchmark adapter contract, metric collection, summaries, and trace helpers

### App ownership

#### `apps/bench`

Responsibility:
- benchmark harness UI
- competitor routes
- scenario execution and output wiring

Implementation note:
- use a Vite React app so the bench app and playground share the same modern frontend baseline initially

#### `apps/playground`

Responsibility:
- manual debug surface
- tiny repro pages for focused investigation

## Dependency Rules

- `@pretable/react` depends on `@pretable/core`
- `@pretable/core` may depend on internal workspace packages
- apps may depend on both public and internal packages
- internal packages are marked private and are not part of the npm API contract
- internal packages may be promoted later only by deliberate design, not by accidental exposure

## Initial Scaffold

The initial scaffold should provide a working monorepo shell without implying that the real grid engine already exists.

Include:
- a fresh Git repository in the current empty workspace at `/Users/blove/repos/pretable`
- `pnpm-workspace.yaml`
- root `package.json` with shared scripts
- root TypeScript, ESLint, Vitest, Playwright, and Changesets setup
- public package skeletons for `@pretable/core` and `@pretable/react`
- internal package skeletons for the engine and benchmark support packages, all marked `private`
- Vite React apps for `apps/bench` and `apps/playground`
- docs and status directories from the product spec
- end-to-end buildable placeholder exports so public packages can be imported immediately

## Publishability

Publishing is a first-class requirement from day one.

Requirements:
- only `@pretable/core` and `@pretable/react` are publishable
- packages include valid npm metadata, `exports`, and build outputs
- Changesets manages versioning and release notes
- internal packages are explicitly marked `private`

## Non-goals

The initial scaffold should not attempt to implement:
- the real grid renderer
- the real text engine
- competitor benchmark adapters
- benchmark result dashboards beyond basic wiring
- extra task-orchestration layers such as Nx or Turborepo unless later justified

## Risks And Tradeoffs

- A plain `pnpm` workspace is simpler than Nx, but it leaves advanced task orchestration and caching for later.
- Keeping the public packages thin early reduces accidental API surface, but it requires discipline so internal packages do not leak through public exports.
- Housing benchmark apps in the same repo improves iteration speed, but it means the workspace must be structured cleanly enough to separate publishable packages from research tooling.

## Planning Readiness

This design is ready to drive an implementation plan for the initial scaffold because it fixes:
- the monorepo foundation
- the package and app layout
- the public versus internal package boundary
- the initial toolchain
- the publishability model

The next step is to write the implementation plan that bootstraps the repository and validates it with build, test, and typecheck commands.
