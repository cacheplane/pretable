# Pretable Benchmark Infrastructure Foundation (P0a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `P0a` benchmark-lab foundation for Pretable: typed scenarios, typed benchmark contracts, a working Pretable benchmark route in `apps/bench`, and a Playwright-driven JSON-and-trace artifact path.

**Architecture:** Keep the contract boundaries narrow and explicit. `scenario-data` owns canonical scenario definitions and deterministic sample data; `bench-runner` owns adapter/result/artifact types plus supported-matrix validation; `apps/bench` owns runtime orchestration and the Pretable adapter; Playwright proves the browser path end to end and writes reproducible status artifacts.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright

---

## File Structure Map

### Package and app files

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/scenario-data/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/scenario-data/src/__tests__/scenario-data.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/bench-runner/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/bench-runner/src/__tests__/bench-runner.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/package.json`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-app.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-runtime.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/query-state.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/window.d.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/query-state.test.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/app.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/app.css`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`

### Root and output files

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/package.json`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/playwright.config.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/status/dashboard.json`

## Task 1: Replace `scenario-data` stub with a typed deterministic registry

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/scenario-data/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/scenario-data/src/__tests__/scenario-data.test.ts`

- [ ] **Step 1: Write the failing scenario registry test**

Write tests that prove:

- `listScenarios()` returns all six named scenarios in stable order
- `getScenarioById("S1")` and `getScenarioById("S2")` return typed definitions
- scenario definitions preserve benchmark-plan fields such as `corpus`, `autosize_all_columns`, and `rich_cells_percent`
- `createScenarioDataset()` is deterministic for the same scenario ID
- generated columns/rows have enough shape for the bench app to mount Pretable without app-local hardcoded scenario arrays

- [ ] **Step 2: Run the package test to verify RED**

Run: `pnpm --filter @pretable-internal/scenario-data test`
Expected: FAIL because the registry and dataset helpers do not exist yet.

- [ ] **Step 3: Write the minimal registry implementation**

Implement:

- typed scenario IDs and row-height modes
- canonical metadata for `S1` through `S6`
- all benchmark-plan scenario fields, even for scenarios not yet runnable in `P0a`
- deterministic sample columns/rows for at least `S1` and `S2`
- exported helpers `listScenarios()`, `getScenarioById()`, `createScenarioDataset()`

Keep the dataset generator intentionally simple and deterministic. Do not attempt realistic multilingual benchmarking data beyond enough variety to exercise the harness.

- [ ] **Step 4: Run the package test to verify GREEN**

Run: `pnpm --filter @pretable-internal/scenario-data test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for the package**

Run:

- `pnpm --filter @pretable-internal/scenario-data typecheck`
- `pnpm --filter @pretable-internal/scenario-data lint`
- `pnpm --filter @pretable-internal/scenario-data build`

Expected: PASS

- [ ] **Step 6: Commit the scenario registry batch**

```bash
git add packages/scenario-data
git commit -m "feat: add benchmark scenario registry"
```

## Task 2: Replace `bench-runner` stub with the benchmark contract and summary helpers

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/bench-runner/src/index.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing benchmark contract test**

Write tests that prove:

- the metric ID union contains the full reserved benchmark schema
- the metric ID union reserves `autosize_runtime_ms` and `scroll_anchor_shift_px`
- the script-name union contains the full reserved script schema
- the supported matrix enforces `pretable + default + chromium + S1/S2 + initial/scroll`
- unsupported profiles, scenarios, and scripts fail explicitly for `P0a`
- unsupported results include the rejected tuple and a reason string
- failed results include a stable serialized error payload
- required metrics are enforced per supported script
- per-run summary creation omits unsupported metrics instead of fabricating values
- artifact path helpers generate stable filenames from adapter/scenario/profile/browser/script
- run summaries carry reproducibility fields such as seed, viewport, font stack, device scale factor, browser version, and trace path
- dashboard aggregation merges run summaries into a deterministic index shape

- [ ] **Step 2: Run the package test to verify RED**

Run: `pnpm --filter @pretable-internal/bench-runner test`
Expected: FAIL because those helpers and types do not exist yet.

- [ ] **Step 3: Write the minimal contract implementation**

Implement:

- benchmark IDs, script names, request/result types, and adapter interfaces
- supported-matrix validators for `P0a`
- required-metric validation for supported scripts
- a helper to create validated run summaries
- artifact filename helpers
- dashboard index helpers

Do not build trace parsing yet. Keep the package focused on contract and serialization rules.

- [ ] **Step 4: Run the package test to verify GREEN**

Run: `pnpm --filter @pretable-internal/bench-runner test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for the package**

Run:

- `pnpm --filter @pretable-internal/bench-runner typecheck`
- `pnpm --filter @pretable-internal/bench-runner lint`
- `pnpm --filter @pretable-internal/bench-runner build`

Expected: PASS

- [ ] **Step 6: Commit the benchmark contract batch**

```bash
git add packages/bench-runner
git commit -m "feat: add benchmark contract helpers"
```

## Task 3: Turn `apps/bench` into a real harness runtime

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/package.json`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-app.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-types.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/bench-runtime.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/pretable-adapter.tsx`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/query-state.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/window.d.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/query-state.test.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/app.tsx`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/src/app.css`

- [ ] **Step 1: Write the failing query/runtime tests**

Write tests that prove:

- query parsing defaults to `adapter=pretable`, `scenario=S1`, `profile=default`, `script=initial`
- invalid query params fall back to safe defaults
- unsupported `P0a` combinations are rejected explicitly
- `autorun=1` is the only path that auto-starts a run
- `window.__PRETABLE_BENCH_RESULT__` only receives terminal `completed`, `partial`, `failed`, or `unsupported` results
- the runtime stores the latest summary on `window.__PRETABLE_BENCH_RESULT__`
- the runtime can build a dashboard entry from a run summary

- [ ] **Step 2: Run the app test target to verify RED**

Run: `pnpm --filter @pretable/app-bench test`
Expected: FAIL because the query and runtime helpers do not exist yet.

- [ ] **Step 3: Implement the minimal harness runtime**

Implement:

- URL query parsing and defaults
- a Pretable adapter registry with one real adapter
- fixed `P0a` reproducibility constants for seed, viewport, font stack, and device scale factor
- Chromium-only `P0a` browser identity in the run contract
- simple timing/DOM-count measurement around mount and scroll
- bench shell UI that renders live scenario metadata from `scenario-data`
- manual run button for `initial` and `scroll`
- assignment of the latest result payload to `window.__PRETABLE_BENCH_RESULT__`
- structured terminal results for `completed`, `partial`, `failed`, and `unsupported`
- explicit structured `unsupported` results for `S3` through `S6`
- stable serialized error payloads for failed adapter runs

Keep this slice honest: if a metric cannot be measured correctly yet, omit it and annotate the run summary instead.

- [ ] **Step 4: Run the app test target to verify GREEN**

Run: `pnpm --filter @pretable/app-bench test`
Expected: PASS

- [ ] **Step 5: Run typecheck, lint, and build for the bench app**

Run:

- `pnpm --filter @pretable/app-bench typecheck`
- `pnpm --filter @pretable/app-bench lint`
- `pnpm --filter @pretable/app-bench build`

Expected: PASS

- [ ] **Step 6: Commit the bench app harness batch**

```bash
git add apps/bench
git commit -m "feat: add benchmark harness runtime"
```

## Task 4: Add the Playwright smoke path and artifact writing

**Files:**

- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/package.json`
- Modify: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/playwright.config.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/apps/bench/tests/bench.spec.ts`
- Create: `/Users/blove/.config/superpowers/worktrees/pretable/codex/pretable-monorepo-scaffold/status/dashboard.json`

- [ ] **Step 1: Write the failing Playwright smoke test**

Write a browser test that:

- opens the bench app for `pretable + S1 + default + initial + autorun=1`
- waits for a machine-readable benchmark result on `window`
- verifies the summary shape
- verifies a trace artifact path is recorded
- writes a per-run JSON summary, aggregate dashboard JSON, and standard trace artifact

- [ ] **Step 2: Run the smoke test to verify RED**

Run: `pnpm exec playwright test apps/bench/tests/bench.spec.ts --project=chromium`
Expected: FAIL because the artifact-writing path and browser assertions do not exist yet.

- [ ] **Step 3: Implement the minimal Playwright harness and scripts**

Implement:

- a root script such as `bench:e2e`
- bench app serving assumptions in Playwright config
- deterministic JSON writing into `status/`
- standard trace writing or copying into `status/traces` for every successful run
- dashboard aggregation update
- Chromium-only `P0a` benchmark execution

Keep trace collection rooted in Playwright rather than inventing a second trace mechanism.

- [ ] **Step 4: Run the smoke test to verify GREEN**

Run: `pnpm exec playwright test apps/bench/tests/bench.spec.ts --project=chromium`
Expected: PASS

- [ ] **Step 5: Expand the smoke path to `S2` if stable**

Run: `pnpm exec playwright test`
Expected: PASS with both `S1` and `S2`, or keep `S2` for the next batch if it introduces instability that would weaken the foundation slice.

- [ ] **Step 6: Commit the Playwright artifact batch**

```bash
git add package.json playwright.config.ts apps/bench/tests status/dashboard.json
git commit -m "feat: add benchmark browser smoke path"
```

## Task 5: Verify the full benchmark foundation slice

**Files:**

- Review and stage all files changed by Tasks 1 through 4

- [ ] **Step 1: Run targeted verification**

Run:

- `pnpm --filter @pretable-internal/scenario-data test`
- `pnpm --filter @pretable-internal/bench-runner test`
- `pnpm --filter @pretable/app-bench test`
- `pnpm exec playwright test`

Expected: PASS

- [ ] **Step 2: Run workspace verification**

Run:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: PASS

- [ ] **Step 3: Inspect output artifacts**

Verify:

- run summaries exist under `status/`
- `status/dashboard.json` reflects the recorded runs
- Playwright trace artifacts exist in `status/traces` for successful runs

- [ ] **Step 4: Commit the verified foundation**

```bash
git add packages/scenario-data packages/bench-runner apps/bench package.json playwright.config.ts status
git commit -m "chore: verify benchmark foundation"
```
