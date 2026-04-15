# S2 Interaction Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden Pretable's proof from passive `S2/scroll` into interaction-driven row-model mutation with explicit named hypotheses for local sort and filter behavior.

**Architecture:** Extend the existing benchmark harness and adapters without forking the Pretable renderer path. Add new deterministic interaction scripts, new interaction metrics, and new hypothesis evaluation in the current matrix/reporting system.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright

---

## File Structure Map

### Scenario and adapter behavior

- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/query-state.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/ag-grid-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/tanstack-adapter.tsx`

### Tests

- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

### Matrix and reporting

- Modify: `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
- Modify: `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`

### Docs and status memory

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

## Task 1: Add `S2/sort` with named `H6`

**Files:**

- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/query-state.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/ag-grid-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/tanstack-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`
- Modify: `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Write failing tests for sort interaction instrumentation**

Add tests that prove:

- the bench runtime can trigger a deterministic local sort action
- the result captures `interaction_latency_ms` and `settle_duration_ms`
- the result captures post-sort stability metrics
- selected and focused row ids are evaluated by row identity rather than viewport position
- the matrix can emit and evaluate named `H6`

- [ ] **Step 2: Run focused tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: FAIL because `sort` interaction proof does not exist yet.

- [ ] **Step 3: Implement minimal sort interaction path**

Requirements:

- add a deterministic local sort action shared semantically across Pretable, AG Grid, and TanStack
- preserve the current scroll scenario path unchanged
- record immediate and post-settle metrics for the sort action
- keep the Pretable adapter on the same renderer/core path already benchmarked
- add named `H6` evaluation to the matrix

- [ ] **Step 4: Run GREEN verification for sort**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`
- `PRETABLE_BENCH_SCRIPT=sort PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_ADAPTER=pretable pnpm bench:e2e -- --project=chromium`

Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/bench scripts packages/bench-runner
git commit -m "feat: add S2 sort interaction proof"
```

## Task 2: Add `S2/filter-metadata` with named `H7`

**Files:**

- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/query-state.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/ag-grid-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/tanstack-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`
- Modify: `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Write failing tests for metadata filter interaction**

Add tests that prove:

- the bench runtime can trigger a deterministic metadata/status filter
- the result captures `result_row_count`
- the result captures row-id-based focus/selection preservation
- the matrix can emit and evaluate named `H7`

- [ ] **Step 2: Run focused tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: FAIL because metadata filter proof does not exist yet.

- [ ] **Step 3: Implement minimal metadata filter path**

Requirements:

- use a deterministic metadata predicate that materially reduces the row set
- drive semantically equivalent local filtering for Pretable, AG Grid, and TanStack
- capture immediate and post-settle metrics
- add named `H7` evaluation to the matrix

- [ ] **Step 4: Run GREEN verification for metadata filter**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`
- `PRETABLE_BENCH_SCRIPT=filter-metadata PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_ADAPTER=pretable pnpm bench:e2e -- --project=chromium`

Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/bench scripts packages/bench-runner
git commit -m "feat: add metadata filter interaction proof"
```

## Task 3: Add `S2/filter-text` with named `H8`

**Files:**

- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/query-state.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/ag-grid-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/tanstack-adapter.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/tests/bench.spec.ts`
- Modify: `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Write failing tests for wrapped-text filter interaction**

Add tests that prove:

- the bench runtime can trigger a deterministic wrapped-text primary-column filter
- the result captures post-filter row count and stability metrics
- the matrix can emit and evaluate named `H8`

- [ ] **Step 2: Run focused tests to verify RED**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: FAIL because wrapped-text filter proof does not exist yet.

- [ ] **Step 3: Implement minimal text filter path**

Requirements:

- use a deterministic wrapped-text token or phrase that materially changes the row set
- preserve comparator parity across Pretable, AG Grid, and TanStack
- capture immediate and post-settle metrics
- add named `H8` evaluation to the matrix

- [ ] **Step 4: Run GREEN verification for text filter**

Run:

- `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-runtime.test.ts`
- `node --test scripts/__tests__/bench-matrix.test.mjs`
- `PRETABLE_BENCH_SCRIPT=filter-text PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_ADAPTER=pretable pnpm bench:e2e -- --project=chromium`

Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/bench scripts packages/bench-runner
git commit -m "feat: add text filter interaction proof"
```

## Task 4: Run repeated proof and update docs honestly

**Files:**

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

- [ ] **Step 1: Run repeated interaction proof at `dev` scale**

Run:

- `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3`

Expected: PASS with valid runsets and hypothesis output.

- [ ] **Step 2: Promote the strongest scenarios to `hypothesis` scale**

Run:

- `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=<strongest-scripts> --scale=hypothesis --repeats=3`

Expected: PASS with valid runsets and honest hypothesis output.

- [ ] **Step 3: Update README and repo memory**

Document:

- what interaction scenarios now exist
- which hypotheses are satisfied, failing, or still directional
- the latest runset paths
- the remaining proof gaps

- [ ] **Step 4: Run full verification**

Run:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Expected: PASS

- [ ] **Step 5: Commit Task 4**

```bash
git add README.md docs/research/repo-memory.md status
git commit -m "docs: capture interaction proof checkpoint"
```

## Final Integration

- [ ] Review the branch against `main`
- [ ] Merge the branch into `main` locally only after all verification passes
- [ ] Re-run a final post-merge verification sweep if the merge changes anything
