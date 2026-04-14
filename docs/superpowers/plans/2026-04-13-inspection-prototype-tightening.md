# Inspection Prototype Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the current Pretable inspection-table prototype so the playground, shared React internals, and benchmark path diverge less, the playground supports serious local manual inspection on large datasets, and the shared path exposes enough telemetry to judge prototype quality honestly.

**Architecture:** Keep the public npm surface unchanged. Move inspection-table-specific configuration and state composition onto internal seams, share more data/config between prototype and benchmark-facing code, and surface renderer/core telemetry through the existing internal React path rather than through ad hoc DOM inspection.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright

---

## File Structure Map

### Shared inspection profile and data

- Create: `/Users/blove/repos/pretable/packages/scenario-data/src/inspection-profile.ts`
- Modify: `/Users/blove/repos/pretable/packages/scenario-data/src/index.ts`
- Modify: `/Users/blove/repos/pretable/packages/scenario-data/src/__tests__/scenario-data.test.ts`

### Internal React prototype composition

- Create: `/Users/blove/repos/pretable/packages/react/src/internal/inspection-grid.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal.ts`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/labeled-grid-surface.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/inspection-grid.test.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/pretable-surface.test.tsx`

### Playground integration

- Modify: `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/__tests__/inspection-demo.test.tsx`

### Benchmark-facing alignment and telemetry

- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`

### Developer docs

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

## Task 1: Extract a shared inspection profile from the playground-only demo code

**Files:**

- Create: `/Users/blove/repos/pretable/packages/scenario-data/src/inspection-profile.ts`
- Modify: `/Users/blove/repos/pretable/packages/scenario-data/src/index.ts`
- Modify: `/Users/blove/repos/pretable/packages/scenario-data/src/__tests__/scenario-data.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx`

- [ ] **Step 1: Write the failing data/profile tests**

Add tests that prove:

- the inspection profile exports schema-agnostic row data plus column definitions
- the profile marks pinned columns and filterable columns explicitly
- row ids remain stable and stringifiable
- the profile supports multiple deterministic dataset scales such as `tiny`, `dev`, and `stress`
- larger scales produce materially larger row counts and preserve the same column/filter semantics

- [ ] **Step 2: Run the package test to verify RED**

Run: `pnpm --filter @pretable-internal/scenario-data test`
Expected: FAIL because the shared inspection profile does not exist yet.

- [ ] **Step 3: Implement the minimal shared inspection profile**

Create a single internal module that exports:

- the inspection demo row type
- deterministic inspection dataset factories for at least:
  - `tiny`: current smoke-test-sized dataset
  - `dev`: large enough for serious local manual inspection
  - `stress`: substantially larger dataset for prototype pressure testing
- the inspection demo columns
- the filterable column id list
- small helpers like `getInspectionFilterValue()`

Requirements:

- dataset generation must be deterministic and reproducible
- wrapped text and row-height variation must scale with size
- pinned columns and filterable metadata must stay identical across scales

Keep benchmark scenario helpers separate. Do not force the benchmark app onto inspection data yet.

- [ ] **Step 4: Move the playground to consume the shared profile and switch scales locally**

Update `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx` to:

- import the rows, columns, and filterable column ids from `@pretable-internal/scenario-data`
- expose a local dataset-scale switcher suitable for manual inspection
- default to a meaningful local-inspection scale, not just the tiny smoke dataset
- keep the tiny dataset available for quick debugging

- [ ] **Step 5: Run GREEN verification for the affected area**

Run:

- `pnpm --filter @pretable-internal/scenario-data test`
- `pnpm --filter @pretable/app-playground test -- --run src/__tests__/inspection-demo.test.tsx`
- `pnpm --filter @pretable/app-playground build`

Expected: PASS

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/scenario-data apps/playground/src/inspection-demo.tsx
git commit -m "refactor: share inspection profile data"
```

## Task 2: Add an internal inspection-grid primitive above the current labeled surface

**Files:**

- Create: `/Users/blove/repos/pretable/packages/react/src/internal/inspection-grid.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal.ts`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/labeled-grid-surface.tsx`
- Create: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/inspection-grid.test.tsx`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/__tests__/inspection-demo.test.tsx`

- [ ] **Step 1: Write the failing internal React tests**

Add tests that prove:

- the new internal `InspectionGrid` composes the labeled grid surface with inspection-specific class names and formatting
- it accepts filterable column metadata and selection callbacks without making the playground own renderer details
- it preserves the existing pinned-column and selection DOM contract
- it works unchanged across the shared inspection dataset scales used by the playground

- [ ] **Step 2: Run the focused React tests to verify RED**

Run: `pnpm --filter @pretable/react test -- --run src/internal/__tests__/inspection-grid.test.tsx`
Expected: FAIL because the new internal primitive does not exist yet.

- [ ] **Step 3: Implement the minimal internal primitive**

Create `inspection-grid.tsx` as an internal-only wrapper that owns:

- inspection-specific class names
- inspection value formatting
- inspection filterable-column metadata input
- pass-through selection callback support

It should still delegate the actual grid DOM contract to `LabeledGridSurface`.

- [ ] **Step 4: Migrate the playground onto the new primitive**

Update `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx` to use the new internal `InspectionGrid` wrapper so the playground keeps product chrome and sidebar logic, but no longer owns inspection-specific renderer composition details.

Do not remove the local dataset-scale switcher added in Task 1.

- [ ] **Step 5: Run GREEN verification for React and playground**

Run:

- `pnpm --filter @pretable/react test -- --run src/internal/__tests__/inspection-grid.test.tsx src/internal/__tests__/labeled-grid-surface.test.tsx src/internal/__tests__/pretable-surface.test.tsx`
- `pnpm --filter @pretable/app-playground test`
- `pnpm --filter @pretable/app-playground typecheck`

Expected: PASS

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/react apps/playground
git commit -m "refactor: add internal inspection grid primitive"
```

## Task 3: Surface renderer and selection telemetry through the shared React path

**Files:**

- Modify: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/pretable-surface.test.tsx`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/inspection-demo.tsx`
- Modify: `/Users/blove/repos/pretable/apps/playground/src/__tests__/inspection-demo.test.tsx`

- [ ] **Step 1: Write the failing telemetry tests**

Add tests that prove:

- `usePretableModel()` exposes renderer snapshot telemetry needed by the playground
- `PretableSurface` can report selected row id, visible row count, total height, and rendered row count without requiring DOM scraping
- the playground can render lightweight diagnostics from the shared telemetry path
- diagnostics remain usable when switching between tiny, dev, and stress inspection datasets

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

- `pnpm --filter @pretable/react test -- --run src/internal/__tests__/pretable-surface.test.tsx`
- `pnpm --filter @pretable/app-playground test -- --run src/__tests__/inspection-demo.test.tsx`

Expected: FAIL because the telemetry seam is not exposed yet.

- [ ] **Step 3: Implement the minimal telemetry seam**

Extend the internal React path to expose a small diagnostics object containing only what the playground and benchmark tooling can use honestly, for example:

- selected row id
- rendered row count
- total planned height
- viewport row range

Do not add a public API for this yet.

- [ ] **Step 4: Render prototype diagnostics in the playground**

Add a small diagnostics block in the inspection demo that consumes the shared telemetry rather than recomputing values from DOM state.

That block should make local manual inspection easier, for example by showing:

- active dataset scale
- rendered row count
- planned total height
- selected row id

- [ ] **Step 5: Run GREEN verification**

Run:

- `pnpm --filter @pretable/react test`
- `pnpm --filter @pretable/app-playground test`
- `pnpm --filter @pretable/app-playground build`

Expected: PASS

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/react apps/playground
git commit -m "feat: expose internal grid telemetry"
```

## Task 4: Tighten benchmark alignment with the shared inspection-oriented React path

**Files:**

- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`
- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

- [ ] **Step 1: Write the failing benchmark-alignment tests**

Add tests that prove:

- the Pretable benchmark adapter still preserves the benchmark viewport policy
- benchmark summaries can record the new internal telemetry without changing existing hypothesis metrics
- no benchmark marker or `data-pretable-*` contract moves

- [ ] **Step 2: Run focused benchmark tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `pnpm --filter @pretable/react test -- --run src/internal/__tests__/pretable-surface.test.tsx`

Expected: FAIL because the shared telemetry/alignment changes are not wired into the benchmark path yet.

- [ ] **Step 3: Wire the Pretable benchmark adapter into the tighter internal path**

Keep the public `Pretable` benchmark-facing contract stable, but update the adapter/runtime path so benchmark summaries can consume the same internal telemetry exposed to the playground where useful.

Guardrails:

- preserve `BENCHMARK_VIEWPORT_STYLE`
- preserve current `data-pretable-*` markers
- do not introduce playground chrome into the benchmark adapter

- [ ] **Step 4: Update developer docs and repo memory**

Document:

- the tighter relationship between playground and benchmark surfaces
- the remaining internal/public boundary
- how to run the playground in a large local-inspection mode
- the next open risks after this milestone

- [ ] **Step 5: Run full repo verification**

Run:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: PASS

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/bench packages/react README.md docs/research/repo-memory.md
git commit -m "feat: align prototype telemetry with benchmark path"
```

## Task 5: Capture a fresh honest status checkpoint after implementation

**Files:**

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`
- Add or update: files under `/Users/blove/repos/pretable/status/runsets/` only if a real matrix run is executed

- [ ] **Step 1: Run a fresh repeated benchmark matrix on the merged prototype path**

Run:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll --repeats=3
```

Expected: PASS with a new runset manifest and hypothesis report in `status/runsets/`.

- [ ] **Step 2: Record the honest status checkpoint**

Update the repo memory and README only if the new evidence changes the current claim quality. Do not overclaim if the telemetry or performance results regress.

- [ ] **Step 3: Commit the status checkpoint**

```bash
git add README.md docs/research/repo-memory.md status/runsets status/dashboard.json
git commit -m "docs: capture prototype status checkpoint"
```
