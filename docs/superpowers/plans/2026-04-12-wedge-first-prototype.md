# Wedge-First Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real Pretable prototype as a schema-agnostic, DOM-first inspection-grid engine that proves the wrapped-text and variable-height wedge while powering both the benchmark app and the playground demo.

**Architecture:** Build from the inside out. `text-core` owns estimate-first prepared text plus DOM-truth checks, `layout-core` owns row-height and viewport math, `grid-core` owns canonical interaction and derived-row-model state, `renderer-dom` owns pooled DOM rendering, and the public React adapter stays thin over the core store. The playground and benchmark app must consume the same engine path.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright, `ResizeObserver`

---

## File Structure Map

### Text engine

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/prepare-text.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/layout-text.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/dom-truth.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/__tests__/text-core.test.ts`

### Layout engine

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/prefix-sums.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/viewport-plan.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/__tests__/layout-core.test.ts`

### Core state and public API

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/create-grid-core.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/derived-rows.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/__tests__/grid-core.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/create-grid.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/types.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/index.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/__tests__/create-grid.test.ts`

### DOM renderer and React adapter

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/create-renderer.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/__tests__/renderer-dom.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/use-pretable.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/pretable.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/index.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/__tests__/pretable.test.tsx`

### Playground and benchmark integration

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.css`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`

### Planning and review docs

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/docs/research/repo-memory.md`

## Task 1: Build `text-core` as an estimate-first engine with DOM-truth checks

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/prepare-text.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/layout-text.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/dom-truth.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/text-core/src/__tests__/text-core.test.ts`

- [ ] **Step 1: Write the failing `text-core` tests**

Write tests that prove:

- `prepareText()` returns a stable prepared record for the same text and font key
- `layoutPreparedText()` returns deterministic line count and height for repeated calls
- narrow widths increase line count and height
- unwrapped layout keeps line count at `1`
- `comparePreparedTextToDomTruth()` returns an error payload instead of throwing when estimate and DOM truth diverge

- [ ] **Step 2: Run the package test to verify RED**

Run: `pnpm --filter @pretable-internal/text-core test`
Expected: FAIL because `prepareText`, `layoutPreparedText`, and the DOM-truth helper do not exist yet.

- [ ] **Step 3: Implement the minimal estimate-first text engine**

Implement a small typed contract like:

```ts
export interface PreparedText {
  text: string;
  fontKey: string;
  graphemeCount: number;
  breakpoints: number[];
  averageCharWidth: number;
}
```

Implement:

- `prepareText(input)`
- `layoutPreparedText(prepared, width, options)`
- `comparePreparedTextToDomTruth(prepared, width, options, element)`

Do not chase full DOM parity yet. Use a simple cached estimate and an explicit truth-comparison helper.

- [ ] **Step 4: Run the package test to verify GREEN**

Run: `pnpm --filter @pretable-internal/text-core test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for `text-core`**

Run:

- `pnpm --filter @pretable-internal/text-core typecheck`
- `pnpm --filter @pretable-internal/text-core lint`
- `pnpm --filter @pretable-internal/text-core build`

Expected: PASS

- [ ] **Step 6: Commit the `text-core` batch**

```bash
git add packages/text-core
git commit -m "feat: add estimate-first text engine"
```

## Task 2: Build `layout-core` row-height and viewport math

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/prefix-sums.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/viewport-plan.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/layout-core/src/__tests__/layout-core.test.ts`

- [ ] **Step 1: Write the failing `layout-core` tests**

Write tests that prove:

- row-height prefix sums map row index to offset and offset to row index
- height corrections update later offsets without recomputing unrelated values
- viewport extraction returns a stable overscanned row range
- pinned-column metadata survives viewport planning without mutating row math

- [ ] **Step 2: Run the package test to verify RED**

Run: `pnpm --filter @pretable-internal/layout-core test`
Expected: FAIL because the row model and viewport helpers do not exist yet.

- [ ] **Step 3: Implement the minimal layout engine**

Implement a compact API like:

```ts
export interface RowMetricsIndex {
  getOffsetForIndex(index: number): number;
  getIndexForOffset(offset: number): number;
  updateHeight(index: number, height: number): void;
}
```

And:

- `createRowMetricsIndex(estimatedHeights)`
- `planViewport({ scrollTop, viewportHeight, overscan, rowMetrics })`
- typed pinned-zone descriptors for later renderer use

- [ ] **Step 4: Run the package test to verify GREEN**

Run: `pnpm --filter @pretable-internal/layout-core test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for `layout-core`**

Run:

- `pnpm --filter @pretable-internal/layout-core typecheck`
- `pnpm --filter @pretable-internal/layout-core lint`
- `pnpm --filter @pretable-internal/layout-core build`

Expected: PASS

- [ ] **Step 6: Commit the `layout-core` batch**

```bash
git add packages/layout-core
git commit -m "feat: add variable-height layout planning"
```

## Task 3: Build `grid-core` as the canonical state machine

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/create-grid-core.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/derived-rows.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/grid-core/src/__tests__/grid-core.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/create-grid.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/types.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/index.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/core/src/__tests__/create-grid.test.ts`

- [ ] **Step 1: Write the failing `grid-core` and public-core tests**

Write tests that prove:

- stable row identity survives sorting and filtering
- limited filter state narrows rows without losing selection ids
- keyboard focus moves by row id / visible order, not by React-local indexes
- the external store can return a snapshot and emit change notifications
- `@pretable/core` re-exports the new grid-core contracts through `createGrid()`

- [ ] **Step 2: Run the package tests to verify RED**

Run:

- `pnpm --filter @pretable-internal/grid-core test`
- `pnpm --filter @pretable/core test`

Expected: FAIL because the state machine and public API do not exist yet.

- [ ] **Step 3: Implement the minimal core state machine**

Implement:

```ts
export interface GridCoreSnapshot {
  viewport: { scrollTop: number; height: number };
  sort: { columnId: string | null; direction: "asc" | "desc" | null };
  filters: Record<string, string>;
  selection: { rowIds: string[]; anchorRowId: string | null };
  focus: { rowId: string | null; columnId: string | null };
}
```

And:

- `createGridCore(options)`
- `subscribe(listener)`
- `getSnapshot()`
- actions for sort, filter, select, focus, and viewport updates
- derived visible-row model keyed by stable row ids

Keep remote compatibility in the contracts, but implement only local in-memory data in this slice.

- [ ] **Step 4: Run the package tests to verify GREEN**

Run:

- `pnpm --filter @pretable-internal/grid-core test`
- `pnpm --filter @pretable/core test`

Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for `grid-core` and `@pretable/core`**

Run:

- `pnpm --filter @pretable-internal/grid-core typecheck`
- `pnpm --filter @pretable-internal/grid-core lint`
- `pnpm --filter @pretable-internal/grid-core build`
- `pnpm --filter @pretable/core typecheck`
- `pnpm --filter @pretable/core lint`
- `pnpm --filter @pretable/core build`

Expected: PASS

- [ ] **Step 6: Commit the core-state batch**

```bash
git add packages/grid-core packages/core
git commit -m "feat: add grid core state machine"
```

## Task 4: Build the pooled DOM renderer and thin React adapter

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/create-renderer.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/renderer-dom/src/__tests__/renderer-dom.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/use-pretable.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/pretable.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/index.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/react/src/__tests__/pretable.test.tsx`

- [ ] **Step 1: Write the failing renderer and React-adapter tests**

Write tests that prove:

- the renderer reuses pooled row shells as the viewport changes
- measured row-height corrections feed back into core without losing row identity
- the React adapter subscribes through an external-store hook rather than owning canonical state
- pinned left columns render in a stable zone
- sort/filter/selection/focus are driven by core snapshots, not React-local arrays

- [ ] **Step 2: Run the package tests to verify RED**

Run:

- `pnpm --filter @pretable-internal/renderer-dom test`
- `pnpm --filter @pretable/react test`

Expected: FAIL because the renderer and adapter path do not exist yet.

- [ ] **Step 3: Implement the minimal renderer and adapter**

Implement:

- a pooled DOM renderer contract in `renderer-dom`
- `ResizeObserver`-based row-height correction hooks
- `usePretable()` as a thin wrapper over core snapshots
- a React `Pretable` component that renders the new engine instead of the current heuristic-only prototype

Do not add richer cells or editing. Keep cells text-first.

- [ ] **Step 4: Run the package tests to verify GREEN**

Run:

- `pnpm --filter @pretable-internal/renderer-dom test`
- `pnpm --filter @pretable/react test`

Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for renderer and adapter**

Run:

- `pnpm --filter @pretable-internal/renderer-dom typecheck`
- `pnpm --filter @pretable-internal/renderer-dom lint`
- `pnpm --filter @pretable-internal/renderer-dom build`
- `pnpm --filter @pretable/react typecheck`
- `pnpm --filter @pretable/react lint`
- `pnpm --filter @pretable/react build`

Expected: PASS

- [ ] **Step 6: Commit the renderer/adapter batch**

```bash
git add packages/renderer-dom packages/react
git commit -m "feat: add dom renderer and react adapter"
```

## Task 5: Turn the playground into the first inspection-table prototype

**Files:**

- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/playground/src/app.css`

- [ ] **Step 1: Write the failing playground interaction smoke test**

Write a small component test that proves:

- the playground renders the inspection-table demo dataset
- a wrapped-text message column is visibly rendered through `Pretable`
- sort and filter controls affect the rendered rows
- pinned metadata columns remain visible

- [ ] **Step 2: Run the playground app test target to verify RED**

Run: `pnpm --filter @pretable/app-playground test`
Expected: FAIL because the demo surface and controls do not exist yet.

- [ ] **Step 3: Implement the minimal inspection-table demo**

Implement:

- a schema-agnostic demo dataset shaped like logs/inspection rows
- a control strip for local sorting and limited filtering
- a clear explanation that the demo is the first wedge-focused prototype, not a full product

Keep the playground focused on the inspection-table use case. Do not broaden it into a generic sandbox yet.

- [ ] **Step 4: Run the playground app test target to verify GREEN**

Run: `pnpm --filter @pretable/app-playground test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for the playground**

Run:

- `pnpm --filter @pretable/app-playground typecheck`
- `pnpm --filter @pretable/app-playground lint`
- `pnpm --filter @pretable/app-playground build`

Expected: PASS

- [ ] **Step 6: Commit the playground batch**

```bash
git add apps/playground
git commit -m "feat: add inspection table playground demo"
```

## Task 6: Wire the same engine into the benchmark app and tighten evidence

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`

- [ ] **Step 1: Write the failing benchmark-integration tests**

Write tests that prove:

- the Pretable benchmark adapter mounts the new shared engine path instead of a private app-only path
- `S2` still emits the expected scroll metrics and policy notes
- the benchmark result still includes sample-count and confidence-aware wording

- [ ] **Step 2: Run the bench tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test`
- `pnpm exec playwright test apps/bench/tests/bench.spec.ts --project=chromium`

Expected: FAIL because the benchmark app is not yet using the new shared engine path.

- [ ] **Step 3: Implement the minimal benchmark integration**

Update the Pretable bench adapter so it mounts the same public React adapter/core path used by the playground. Keep the benchmark harness and reporting logic intact; this slice is about sharing the engine path, not rewriting the benchmark lab.

- [ ] **Step 4: Run the bench tests to verify GREEN**

Run:

- `pnpm --filter @pretable/app-bench test`
- `pnpm exec playwright test apps/bench/tests/bench.spec.ts --project=chromium`

Expected: PASS

- [ ] **Step 5: Run the matrix smoke path**

Run:

- `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta --scenarios=S2 --scripts=scroll --repeats=1`

Expected:

- PASS
- a new runset in `status/runsets/`
- Pretable evidence still serializes `policyNotes`, `metricSummary`, and confidence-aware summaries

- [ ] **Step 6: Commit the benchmark-integration batch**

```bash
git add apps/bench status/runsets
git commit -m "feat: share prototype engine with benchmark app"
```

## Task 7: Run the full repo verification and capture the honest assessment checkpoint

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/docs/research/repo-memory.md`

- [ ] **Step 1: Update the repo memory with the implemented prototype checkpoint**

Record:

- what parts of the prototype are real
- what is still deferred
- which hypotheses are now measured versus still unproven

- [ ] **Step 2: Run the full repo verification sweep**

Run:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: PASS

- [ ] **Step 3: Run one fresh benchmark proof command**

Run:

- `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta --scenarios=S2 --scripts=scroll --repeats=3`

Expected:

- PASS
- fresh runset and hypothesis report
- claim text reflects repeated-run confidence honestly

- [ ] **Step 4: Write the checkpoint summary**

Write a short status summary covering:

- prototype capabilities now implemented
- benchmark findings that are actually supported
- open gaps before MVP, especially autosize and streaming

- [ ] **Step 5: Commit the checkpoint batch**

```bash
git add docs/research/repo-memory.md status/runsets
git commit -m "docs: capture prototype checkpoint"
```

- [ ] **Step 6: Stop and review before expanding scope**

Before adding autosize, streaming, or richer cells, re-read:

- `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/docs/superpowers/specs/2026-04-12-wedge-first-prototype-design.md`
- the latest runset in `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/status/runsets/`

Confirm that the wedge is still holding on the shared engine path before broadening product scope.
