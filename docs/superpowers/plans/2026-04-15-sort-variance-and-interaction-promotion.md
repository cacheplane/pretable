# Sort Variance And Interaction Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the current repeated-run sort outlier on Chromium `S2/dev`, then promote the full local interaction proof family (`sort`, `filter-metadata`, `filter-text`) to a larger Chromium-only interaction checkpoint.

**Architecture:** Use the benchmark harness as the reproduction surface, but profile and fix the shared Pretable sort path rather than narrowing the harness. Keep benchmark and prototype behavior aligned, preserve the existing `data-pretable-*` DOM contract and honest hypothesis model, and only run the `hypothesis`-scale interaction promotion pass after `H6`, `H7`, and `H8` are all green on repeated `dev`.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright, Chromium

---

## File Structure Map

### Shared Pretable behavior and profiling target

- Inspect/modify: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Inspect/modify: `/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/packages/renderer-dom/src/create-renderer.ts`
- Inspect/modify: `/Users/blove/repos/pretable/packages/grid-core/src/*` only if profiling proves sort churn originates there

### Bench reproduction and hypothesis evaluation

- Inspect/modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
- Inspect/modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
- Inspect/modify: `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`

### Tests

- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-app.test.tsx`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/pretable-surface.test.tsx`
- Modify: `/Users/blove/repos/pretable/packages/bench-runner/src/__tests__/bench-runner.test.ts`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

### Docs and checkpoint tracking

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

## Task 1: Reproduce And Profile The Shared Sort Variance

**Files:**

- Read only: `/Users/blove/repos/pretable/status/runsets/2026-04-15t06-03-15-343z.hypotheses.json`
- Read only: `/Users/blove/repos/pretable/status/chromium-pretable-default-s2-dev-sort-*.summary.json`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Capture a fresh focused reproduction for `S2/dev/sort`**

Run:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort --repeats=3
```

Record:

- the new runset path
- `interaction_latency_ms` min/median/max
- `settle_duration_ms` min/median/max
- whether the outlier remains in the same range as the current `74.6ms` spike

- [ ] **Step 2: Profile the shared Pretable sort path before writing code**

Use the benchmark reproduction and the current shared path to determine which category spikes:

- grid state mutation
- render snapshot regeneration
- row-height measurement churn
- React surface rerender churn

Write down the observed dominant category in task notes before creating any new regression tests.

- [ ] **Step 3: Write the smallest failing regression tests now that the likely root cause is known**

Add focused tests that prove the specific failure semantics you observed, for example:

- current code distinguishes median-within-threshold but worst-case-exceeded `H6`
- sort interaction metrics stay stable when the row model changes only once
- the `H6` report wording for worst-case-repeat failure remains honest

The tests should be narrowly tied to the profiled failure mode, not broad placeholders written before root-cause investigation.

- [ ] **Step 4: Run the focused tests to verify RED**

Run:

```bash
pnpm --filter @pretable/app-bench exec vitest run src/__tests__/bench-runtime.test.ts --environment jsdom --reporter verbose
node --test /Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs
```

Expected:

- at least one new test fails for the intended sort-variance reason
- the failure is about the profiled issue, not a typo or missing import

- [ ] **Step 5: Commit the bounded-red-state tests if they are cleanly targeted**

```bash
git add /Users/blove/repos/pretable/apps/bench/src/__tests__/bench-runtime.test.ts /Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs
git commit -m "test: lock sort variance failure semantics"
```

## Task 2: Profile The Shared Sort Path And Write A Targeted Failing Test

**Files:**

- Inspect/modify: `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Inspect/modify: `/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx`
- Inspect/modify: `/Users/blove/repos/pretable/packages/renderer-dom/src/create-renderer.ts`
- Modify: `/Users/blove/repos/pretable/apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `/Users/blove/repos/pretable/packages/react/src/internal/__tests__/pretable-surface.test.tsx`

- [ ] **Step 1: Reproduce the sort spike under a focused profile pass**

Use the existing benchmark path and a local profiler strategy appropriate to the repo. The minimum deliverable is a written note in your scratch context that identifies which shared phase spikes:

- grid state mutation
- render snapshot regeneration
- measured-height churn
- React rerender churn

Do not write repo code yet.

- [ ] **Step 2: Choose the smallest shared-code seam that can express the suspected root cause**

Before writing implementation, identify exactly where the new regression test belongs:

- `pretable-adapter` if the churn is still adapter-triggered
- `use-pretable` if the issue is snapshot/telemetry churn
- `pretable-surface` if the issue is React rerender or measurement-loop churn
- `create-renderer` if the issue is render-plan recomputation churn

Write that choice down in the task notes before editing.

- [ ] **Step 3: Write one failing targeted regression test at the chosen seam**

The test must express the specific shared-path problem you observed, for example:

- sort should not trigger redundant render-plan recomputation for unchanged row heights
- sort should not clear and restore selected/focused row state within one interaction
- sort should not recreate a measured-height or visible-range loop after one deterministic reorder

Do not bundle multiple suspected causes into one test.

- [ ] **Step 4: Run the targeted test to verify RED**

Run the smallest relevant command, for example:

```bash
pnpm --filter @pretable/app-bench exec vitest run src/__tests__/pretable-adapter.test.tsx --environment jsdom --reporter verbose
pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom --reporter verbose
```

Expected:

- the new regression test fails for the intended sort-churn reason

## Task 3: Implement The Smallest Shared-Code Fix For Sort Determinism

**Files:**

- Modify only the seam chosen in Task 2, plus the minimum call-site/support files needed
- Likely candidates:
  - `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
  - `/Users/blove/repos/pretable/packages/react/src/internal/pretable-surface.tsx`
  - `/Users/blove/repos/pretable/packages/renderer-dom/src/create-renderer.ts`
  - `/Users/blove/repos/pretable/apps/bench/src/pretable-adapter.tsx`

- [ ] **Step 1: Implement the minimal shared-code fix**

Constraints:

- do not change the benchmark DOM contract
- do not add benchmark-only shortcuts unless profiling proved the issue is benchmark-only
- do not relax `H6` threshold logic here
- do not add speculative instrumentation in the same commit

- [ ] **Step 2: Run the targeted test to verify GREEN**

Run the same focused test command from Task 2.

Expected:

- the new regression test passes
- nearby tests in the same file still pass

- [ ] **Step 3: Run the focused sort reproduction again**

Run:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort --repeats=3
```

Evaluate:

- did the worst-case repeat drop materially?
- is `H6` now satisfied?
- if not, is the remaining problem clearly different from the one just fixed?

- [ ] **Step 4: Commit the shared-code variance fix**

```bash
git add /Users/blove/repos/pretable/apps/bench /Users/blove/repos/pretable/packages/react /Users/blove/repos/pretable/packages/renderer-dom
git commit -m "fix: reduce sort interaction variance"
```

## Task 4: Revalidate The Full `dev` Interaction Family

**Files:**

- Modify only if new regressions appear:
  - `/Users/blove/repos/pretable/apps/bench/src/bench-runtime.ts`
  - `/Users/blove/repos/pretable/apps/bench/src/bench-app.tsx`
  - `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`
  - `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
  - matching tests

- [ ] **Step 1: Run the full repeated Chromium `dev` interaction family**

Run:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3
```

- [ ] **Step 2: Check the resulting runset honestly**

Record:

- runset path
- `H6` status
- `H7` status
- `H8` status
- whether failures are median failures or worst-case-repeat failures

- [ ] **Step 3: If `H6` is still failing, stop and open a second profiling loop instead of promoting**

Do not proceed to `hypothesis` scale if:

- `H6` remains failing
- or `H7` / `H8` regress because of the sort fix

If this happens, write down the new failure mode and return to Task 2 with a new narrowly scoped test.

- [ ] **Step 4: If all three are green, commit the stable `dev` checkpoint code**

```bash
git add /Users/blove/repos/pretable/apps/bench /Users/blove/repos/pretable/packages/bench-runner /Users/blove/repos/pretable/scripts
git commit -m "feat: stabilize dev interaction proof"
```

## Task 5: Run The Chromium-Only `hypothesis` Interaction Promotion Pass

**Files:**

- No code changes expected initially
- If report wording or thresholds need honest clarification after valid evidence, modify:
  - `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`
  - `/Users/blove/repos/pretable/scripts/bench-matrix.mjs`
  - tests in `/Users/blove/repos/pretable/packages/bench-runner/src/__tests__/bench-runner.test.ts`
  - tests in `/Users/blove/repos/pretable/scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Confirm the promotion gate is actually satisfied**

Do not continue unless the latest repeated `dev` runset has:

- `H6`: satisfied
- `H7`: satisfied
- `H8`: satisfied

If any of these are not satisfied, stop here and return to Task 2 rather than running promotion.

- [ ] **Step 2: Run the larger Chromium-only promotion pass**

Run:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3
```

- [ ] **Step 3: Inspect the promotion runset**

Record:

- runset path
- `H6` / `H7` / `H8` status
- any new worst-case-repeat spikes
- any metric that worsens materially from `dev`

- [ ] **Step 4: Only change reporting if the new evidence shows a real honesty gap**

Examples of acceptable report-only work:

- clearer summary text for worst-case-repeat failures
- clearer explanation of repeated-run median vs worst-case evidence

Do not change thresholds here unless the user explicitly approves claim redefinition.

- [ ] **Step 5: Commit any necessary honest-reporting adjustments**

```bash
git add /Users/blove/repos/pretable/packages/bench-runner /Users/blove/repos/pretable/scripts
git commit -m "docs: clarify interaction promotion evidence"
```

## Task 6: Update Repo Memory And Developer Docs

**Files:**

- Modify: `/Users/blove/repos/pretable/README.md`
- Modify: `/Users/blove/repos/pretable/docs/research/repo-memory.md`

- [ ] **Step 1: Write the new checkpoint into README**

Include:

- the latest repeated `dev` interaction runset path
- the latest repeated `hypothesis` interaction runset path, if promotion happened
- which of `H6`, `H7`, `H8` are satisfied or still mixed
- the next honest technical gap after this phase

- [ ] **Step 2: Write the durable summary into repo memory**

Document:

- the specific root cause category that drove sort variance
- whether the fix landed in shared code or benchmark-local code
- the new state of `H6` / `H7` / `H8`
- what should happen next

- [ ] **Step 3: Commit the documentation checkpoint**

```bash
git add /Users/blove/repos/pretable/README.md /Users/blove/repos/pretable/docs/research/repo-memory.md
git commit -m "docs: capture interaction promotion checkpoint"
```

## Task 7: Final Verification Before Completion

**Files:**

- No planned edits

- [ ] **Step 1: Run focused verification for the touched benchmark and shared-path code**

Run the smallest relevant command set based on the files actually changed during execution. At minimum, this should include the targeted unit/app tests for the profiled sort fix and the repeated benchmark command that supports the closing claim.

Likely commands:

```bash
pnpm --filter @pretable/app-bench exec vitest run src/__tests__/bench-runtime.test.ts --environment jsdom --reporter verbose
pnpm --filter @pretable/app-bench exec vitest run src/__tests__/pretable-adapter.test.tsx --environment jsdom --reporter verbose
pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom --reporter verbose
```

Expected:

- all focused verification commands exit `0`

- [ ] **Step 2: Run the final benchmark proof command that supports the closing claim**

At minimum, rerun:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3
```

If promotion was completed and is part of the closing claim, also rerun:

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3
```

- [ ] **Step 3: Prepare the closing summary**

The final handoff must report:

- the exact runset path(s)
- whether `H6`, `H7`, and `H8` are satisfied
- whether promotion happened
- what still remains unresolved, if anything

- [ ] **Step 4: Only run repo-wide `pnpm lint`, `pnpm test`, `pnpm typecheck`, and `pnpm build` if the touched files and current repo policy make that the expected release gate**

If you run the full repo gate, report it. If you do not, say explicitly that the closing claim is backed by focused verification plus the benchmark runset rather than the full workspace sweep.
