# S2 Grouping Scheduler Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in, bench-native attribution for one real S2 grouping query transition and commit a controlled current-main evidence milestone without changing production scheduling behavior.

**Architecture:** The internal row-model diagnostics will record scheduler wait samples beside existing slice samples. The bench diagnostics controller will arm and capture exactly the next proxied `setQuery`, while the discrete interaction runtime will use the shared monotonic clock to partition trigger-to-settled time into pre-model, model, and post-model components. A diagnostics-only budget input will perturb the private row-model constructor for measurement; the production default remains untouched.

**Tech Stack:** TypeScript, React 19, Vitest, Playwright/Chromium, Vite, pnpm, internal Pretable row-model and bench packages.

---

**Design:** `docs/superpowers/specs/2026-08-31-s2-grouping-scheduler-attribution-design.md`

**Execution note:** This session cannot dispatch subagents. Execute inline with `superpowers:executing-plans`, use TDD for every behavior change, and self-review each completed batch before continuing.

## File map

- Create `packages/row-model/src/__tests__/cooperative-transition-runtime.test.ts` for deterministic scheduler-wait instrumentation.
- Modify `packages/row-model/src/cooperative-transition.ts` to time successful scheduled callbacks with the runtime clock.
- Modify `packages/row-model/src/diagnostics.ts` to store/reset/expose scheduler waits.
- Modify `apps/bench/src/row-model-diagnostics.ts` to arm, capture, disarm, and summarize one query transition.
- Modify `apps/bench/src/bench-types.ts` for private query-transition artifact types and the optional diagnostic budget.
- Modify `apps/bench/src/bench-runtime.ts` to attach diagnostics to the discrete interaction lifecycle and derive the three timing partitions.
- Modify `apps/bench/src/bench-app.tsx` to pass diagnostics into interaction measurement and attach any row-model summary generically.
- Modify `apps/bench/src/query-state.ts` to parse the optional diagnostic budget.
- Modify `apps/bench/src/pretable-adapter.tsx` to forward the budget only to the private model owner.
- Modify `apps/bench/tests/bench.spec.ts` to map the environment variable and assert the real-browser contract.
- Modify existing bench unit tests under `apps/bench/src/__tests__/` for controller, runtime, app, adapter, and query-state behavior.
- Create `status/milestones/2026-08-31-s2-grouping-scheduler-attribution.json` only after the controlled run finishes.

### Task 1: Record scheduler wait durations inside instrumented row models

**Files:**

- Create: `packages/row-model/src/__tests__/cooperative-transition-runtime.test.ts`
- Modify: `packages/row-model/src/cooperative-transition.ts`
- Modify: `packages/row-model/src/diagnostics.ts`
- Update fixtures as required: `packages/row-model/src/__tests__/filter-fast-path.test.ts`, `packages/row-model/src/__tests__/sort-fast-path.test.ts`, `packages/row-model/src/__tests__/order-statistic-tree.test.ts`

- [ ] **Step 1: Write the failing successful-callback timing test**

Use `createInstrumentedLocalRowModel`, a manual scheduler, and a mutable clock. Start a sufficiently large grouped transition, advance the clock by 5 ms before flushing the first queued callback, and assert:

```ts
expect(instrumented.diagnostics.read().work.schedulerWaitDurations).toEqual([
  5,
]);
```

Keep the clock frozen while the callback executes so the existing slice duration remains deterministic.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @pretable-internal/row-model test -- cooperative-transition-runtime.test.ts
```

Expected: FAIL because `schedulerWaitDurations` does not exist.

- [ ] **Step 3: Write the failing cancellation/reset tests**

Add separate tests proving:

```ts
transition.cancel();
scheduler.flushAll();
expect(diagnostics.read().work.schedulerWaitDurations).toEqual([]);

diagnostics.resetWork();
expect(diagnostics.read().work.schedulerWaitDurations).toEqual([]);
```

Also verify `read()` returns a frozen copy that cannot be changed by later samples.

- [ ] **Step 4: Implement the minimal scheduler instrumentation**

In `diagnostics.ts`, add `schedulerWaitDurations` everywhere
`schedulerSliceDurations` is initialized, reset, and snapshotted.

In `createCooperativeTransitionRuntime`, resolve the clock first:

```ts
const now =
  options.now ??
  (() =>
    typeof performance === "object" &&
    performance !== null &&
    typeof performance.now === "function"
      ? performance.now()
      : Date.now());
```

Then wrap successful scheduling:

```ts
const scheduledAt = now();
cancel = scheduler.schedule(() => {
  instrumentation.scheduledCallbacks.delete(token);
  instrumentation.work.schedulerWaitDurations.push(
    Math.max(0, now() - scheduledAt),
  );
  task();
});
```

Do not record on cancellation or a thrown `schedule` call. Return the same
`now` function in the runtime.

- [ ] **Step 5: Update structural instrumentation fixtures**

Where tests construct `LocalRowModelInstrumentation` literals, add:

```ts
schedulerWaitDurations: [],
```

Do not loosen any existing assertion.

- [ ] **Step 6: Verify GREEN and the complete row-model package**

Run:

```bash
pnpm --filter @pretable-internal/row-model test -- cooperative-transition-runtime.test.ts
pnpm --filter @pretable-internal/row-model test
pnpm --filter @pretable-internal/row-model typecheck
```

Expected: focused tests pass, then the full row-model suite and typecheck pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/row-model/src/cooperative-transition.ts packages/row-model/src/diagnostics.ts packages/row-model/src/__tests__
git commit -m "test(row-model): measure cooperative scheduler waits"
```

### Task 2: Capture exactly one bench query transition

**Files:**

- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/row-model-diagnostics.ts`
- Test: `apps/bench/src/__tests__/row-model-diagnostics.test.ts`

- [ ] **Step 1: Write the failing arm-next lifecycle test**

Use a manual scheduler and injected clock. Prove an unarmed `setQuery` is ignored, then arm and invoke the proxied model:

```ts
expect(controller.readQueryTransition()).toBeNull();
controller.armNextQueryTransition();
const transition = controller.model.setQuery(groupedQuery);
expect(controller.readQueryTransition()).toMatchObject({
  status: "running",
});
scheduler.flushAll();
await transition.finished;
expect(controller.readQueryTransition()).toMatchObject({
  status: "completed",
  durationMs: expect.any(Number),
});
```

Assert the summary contains rows evaluated, transition rows, slice statistics,
wait statistics, and non-negative residual.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @pretable/app-bench test -- row-model-diagnostics.test.ts
```

Expected: FAIL because the arm/read/disarm API does not exist.

- [ ] **Step 3: Add failing rejection, cancellation, and disarm tests**

Pin these independent behaviors:

- canceled transition reports `cancelled`, not `completed`;
- rejected transition reports `error` and retains finite counters;
- `disarmQueryTransition()` prevents a later query from being captured;
- arming again clears the previous capture and resets work;
- `readQueryTransition()` returns an immutable snapshot.

- [ ] **Step 4: Add private artifact types**

In `bench-types.ts`, introduce:

```ts
export type RowModelQueryTransitionStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "error";

export interface RowModelQueryTransitionSummary {
  readonly status: RowModelQueryTransitionStatus;
  readonly durationMs: number;
  readonly rowsEvaluated: number;
  readonly transitionRows: number;
  readonly sliceCount: number;
  readonly sliceTotalMs: number;
  readonly sliceP95Ms: number;
  readonly sliceMaxMs: number;
  readonly schedulerWaitCount: number;
  readonly schedulerWaitTotalMs: number;
  readonly schedulerWaitP95Ms: number;
  readonly schedulerWaitMaxMs: number;
  readonly residualMs: number;
}
```

Add `queryTransition?: RowModelQueryTransitionSummary | null` to
`RowModelBenchSummary`. Keep timestamps out of the serialized type.

- [ ] **Step 5: Implement arm/capture/disarm minimally**

Proxy `setQuery` as well as `applyTransaction`. When armed, record
`startedAt`, call the real model, retain the handle, and settle one capture from
`transition.finished`. Classify `PretableTransitionCancelledError` separately
from other rejection.

Expose an internal runtime read that includes start/completion timestamps, and
make the serializable read aggregate arrays with the existing percentile helper
or a small local equivalent:

```ts
const sliceTotalMs = sum(work.schedulerSliceDurations);
const schedulerWaitTotalMs = sum(work.schedulerWaitDurations);
const residualMs = Math.max(
  0,
  durationMs - sliceTotalMs - schedulerWaitTotalMs,
);
```

Do not change `startQueryCandidate`; route it through one shared timed-query
helper so streaming rebuild diagnostics keep their existing behavior.

- [ ] **Step 6: Verify GREEN and bench unit types**

Run:

```bash
pnpm --filter @pretable/app-bench test -- row-model-diagnostics.test.ts
pnpm --filter @pretable/app-bench typecheck
```

Expected: focused suite and bench typecheck pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/row-model-diagnostics.ts apps/bench/src/__tests__/row-model-diagnostics.test.ts
git commit -m "feat(bench): capture one diagnostic query transition"
```

### Task 3: Partition the real discrete interaction and serialize diagnostics

**Files:**

- Modify: `apps/bench/src/bench-runtime.ts`
- Modify: `apps/bench/src/bench-app.tsx`
- Test: `apps/bench/src/__tests__/bench-runtime.test.ts`
- Test: `apps/bench/src/__tests__/bench-app.test.tsx`
- Test: `apps/bench/tests/bench.spec.ts`

- [ ] **Step 1: Write and run the failing real-browser artifact assertion**

Before runtime wiring exists, assert that a smoke-scale Pretable `group` run
with `diagnostics=row-model` owns a completed
`rowModel.queryTransition` carrying duration, pre/post model partitions, rows,
slice count, and scheduler-wait count. Build and run the direct Playwright spec
against an unused strict port.

Run:

```bash
pnpm --filter @pretable/app-bench build
PRETABLE_BENCH_EXTERNAL_SERVER=1 \
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519 \
PRETABLE_BENCH_ADAPTER=pretable \
PRETABLE_BENCH_SCENARIO=S2 \
PRETABLE_BENCH_SCALE=smoke \
PRETABLE_BENCH_SCRIPT=group \
PRETABLE_BENCH_DIAGNOSTICS=row-model \
pnpm bench:e2e apps/bench/tests/bench.spec.ts
```

Expected: FAIL because interaction runs do not serialize `rowModel`.

- [ ] **Step 2: Write the failing runtime test**

Extend a completed `group` measurement fixture with a fake diagnostics
controller. Assert that `measureBenchInteractionRun`:

- arms immediately inside the trigger wrapper;
- emits `rowModel.queryTransition`;
- derives `preModelHandoffMs` from `modelStartedAt - interactionStart`;
- derives `postModelSurfaceMs` from `settledAt - modelCompletedAt`; and
- disarms after success.

The partition must satisfy, within clock rounding:

```ts
expect(preModelHandoffMs + durationMs + postModelSurfaceMs).toBeCloseTo(
  interactionLatencyMs + settleDurationMs,
  5,
);
```

- [ ] **Step 3: Run the focused runtime test and verify RED**

Run:

```bash
pnpm --filter @pretable/app-bench test -- bench-runtime.test.ts
```

Expected: FAIL because interaction measurement accepts no diagnostics and
returns no row-model summary.

- [ ] **Step 4: Add failing partial/throw cleanup tests**

Assert `disarmQueryTransition()` runs when the measurement returns `partial`
and when the trigger or frame loop throws. A missing captured `setQuery` under
explicit diagnostics must make the interaction partial with a precise note,
not serialize a zero-cost transition.

- [ ] **Step 5: Implement the trigger wrapper and timing partition**

Add `diagnostics?: RowModelDiagnosticsController | null` to
`measureBenchInteractionRun`. Wrap the existing trigger:

```ts
const diagnosticTrigger = () => {
  diagnostics?.armNextQueryTransition();
  trigger();
};
```

Return `startTimestamp` and `settledAt` from the completed internal
`measureRowSetChange` result. In `finally`, disarm capture. Before disarming,
read the internal timestamps and build a serializable query summary with:

```ts
preModelHandoffMs: Math.max(0, modelStartedAt - startTimestamp),
postModelSurfaceMs: Math.max(0, settledAt - modelCompletedAt),
```

Add both derived fields to `RowModelQueryTransitionSummary`; do not expose the
absolute timestamps in the artifact type.

Treat a missing or non-completed capture as partial for diagnostic grouping
runs.

- [ ] **Step 6: Generalize app-level row-model attachment**

Add optional `rowModel` to `BenchMeasuredRun`. Pass
`rowModelDiagnosticsRef.current` into `measureBenchInteractionRun` only for
explicit diagnostics. Replace the update-only attachment check with:

```ts
const nextResult =
  measured?.run?.rowModel === undefined
    ? measuredResult
    : { ...measuredResult, rowModel: measured.run.rowModel };
```

Ordinary interaction runs must remain byte-for-byte absent of `rowModel`.

- [ ] **Step 7: Add the app-level regression test**

In `bench-app.test.tsx`, run a smoke-scale diagnostic `group` autorun with a
controller stub and assert the published result owns `rowModel.queryTransition`.
Run the same script without diagnostics and assert `rowModel` is absent.

- [ ] **Step 8: Verify GREEN in unit and browser layers**

Run:

```bash
pnpm --filter @pretable/app-bench test -- bench-runtime.test.ts bench-app.test.tsx
pnpm --filter @pretable/app-bench typecheck
PRETABLE_BENCH_EXTERNAL_SERVER=1 \
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519 \
PRETABLE_BENCH_ADAPTER=pretable \
PRETABLE_BENCH_SCENARIO=S2 \
PRETABLE_BENCH_SCALE=smoke \
PRETABLE_BENCH_SCRIPT=group \
PRETABLE_BENCH_DIAGNOSTICS=row-model \
pnpm bench:e2e apps/bench/tests/bench.spec.ts
```

Expected: focused suites and typecheck pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add apps/bench/src/bench-runtime.ts apps/bench/src/bench-app.tsx apps/bench/src/__tests__/bench-runtime.test.ts apps/bench/src/__tests__/bench-app.test.tsx apps/bench/tests/bench.spec.ts
git commit -m "feat(bench): attribute grouping interaction phases"
```

### Task 4: Plumb the diagnostics-only transition budget

**Files:**

- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/bench/src/row-model-diagnostics.ts`
- Modify: `apps/bench/src/bench-app.tsx`
- Test: `apps/bench/src/__tests__/query-state.test.ts`
- Test: `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Test: `apps/bench/src/__tests__/row-model-diagnostics.test.ts`

- [ ] **Step 1: Write failing parser tests**

Assert a valid value is preserved:

```ts
expect(
  parseBenchQuery(
    "?adapter=pretable&diagnostics=row-model&transitionBudgetMs=1",
  ).transitionBudgetMs,
).toBe(1);
```

Assert `0`, negative, `Infinity`, `NaN`, and missing values become `undefined`.

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```bash
pnpm --filter @pretable/app-bench test -- query-state.test.ts
```

Expected: FAIL because the query field is absent.

- [ ] **Step 3: Implement minimal parsing and types**

Add `transitionBudgetMs?: number` to `BenchQueryState`. Parse with:

```ts
const parsed = Number(raw);
return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
```

Do not substitute a new default; omission must reach the model unchanged.

- [ ] **Step 4: Write failing forwarding tests**

Pin both sides:

- Pretable + diagnostics forwards `1` to the instrumented model and its runtime
  exposes `budgetMs === 1` through observable slice behavior.
- diagnostics disabled ignores the query value and creates the ordinary model
  with the production default.

- [ ] **Step 5: Implement diagnostic-only forwarding**

Add `transitionBudgetMs` to private adapter/model-owner inputs and pass it as
`transitionBudgetMs` to `createInstrumentedLocalRowModel`. In `bench-app.tsx`,
forward only when `query.adapterId === "pretable" && query.diagnostics`.

Do not add the option to a public Pretable React API.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @pretable/app-bench test -- query-state.test.ts pretable-adapter.test.tsx row-model-diagnostics.test.ts
pnpm --filter @pretable/app-bench typecheck
```

Expected: focused tests and typecheck pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/pretable-adapter.tsx apps/bench/src/row-model-diagnostics.ts apps/bench/src/bench-app.tsx apps/bench/src/__tests__
git commit -m "feat(bench): vary cooperative budget in diagnostic runs"
```

### Task 5: Pin diagnostic-budget browser plumbing

**Files:**

- Modify: `apps/bench/tests/bench.spec.ts`
- Modify as needed: `apps/bench/src/window.d.ts`

- [ ] **Step 1: Write the failing requested-budget assertion**

Read:

```ts
const transitionBudgetMs =
  process.env.PRETABLE_BENCH_TRANSITION_BUDGET_MS;
```

Append the encoded query parameter when present. For Pretable interaction runs
with `diagnostics === "row-model"`, retain the Task 3 transition assertions and
also assert the artifact names the requested perturbation:

```ts
expect(result.notes).toContain(
  `requested row model transition budget ms: ${Number(transitionBudgetMs)}`,
);
```

Also assert all timing fields are finite/non-negative and the three top-level
partitions reconcile with total interaction time within a small floating-point
tolerance.

- [ ] **Step 2: Build and run the real browser test to verify RED**

Run on an unused strict port:

```bash
pnpm --filter @pretable/app-bench build
PRETABLE_BENCH_EXTERNAL_SERVER=1 \
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519 \
PRETABLE_BENCH_ADAPTER=pretable \
PRETABLE_BENCH_SCENARIO=S2 \
PRETABLE_BENCH_SCALE=smoke \
PRETABLE_BENCH_SCRIPT=group \
PRETABLE_BENCH_DIAGNOSTICS=row-model \
PRETABLE_BENCH_TRANSITION_BUDGET_MS=1 \
pnpm bench:e2e apps/bench/tests/bench.spec.ts
```

Expected: FAIL because the direct spec does not yet append the environment value
and the artifact does not yet name the requested budget. Start the built preview
separately with `--strictPort`.

- [ ] **Step 3: Complete only the browser wiring revealed by the failure**

Append `transitionBudgetMs` to the URL, keep the Task 4 parser/adapter forwarding,
and add the requested-budget note only for explicit diagnostic runs. Do not
change the timing algorithm or production defaults.

- [ ] **Step 4: Verify the real browser contract and full bench suite**

Run:

```bash
PRETABLE_BENCH_EXTERNAL_SERVER=1 \
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519 \
PRETABLE_BENCH_ADAPTER=pretable \
PRETABLE_BENCH_SCENARIO=S2 \
PRETABLE_BENCH_SCALE=smoke \
PRETABLE_BENCH_SCRIPT=group \
PRETABLE_BENCH_DIAGNOSTICS=row-model \
PRETABLE_BENCH_TRANSITION_BUDGET_MS=1 \
pnpm bench:e2e apps/bench/tests/bench.spec.ts
pnpm --filter @pretable/app-bench test
pnpm --filter @pretable/app-bench typecheck
```

Expected: browser contract, all bench unit tests, and typecheck pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/bench/tests/bench.spec.ts apps/bench/src/window.d.ts
git commit -m "test(bench): pin grouping attribution artifacts"
```

### Task 6: Run the current-main attribution experiment

**Files:**

- Create: `status/milestones/2026-08-31-s2-grouping-scheduler-attribution.json`
- Generated untracked inputs: `status/chromium-pretable-default-s2-target-*.summary.json`
- Optional committed trace: `status/traces/chromium-pretable-default-s2-target-group-*.cdp.json`

- [ ] **Step 1: Verify the measurement base and environment**

Record:

```bash
git rev-parse HEAD
git rev-parse origin/main
node --version
pnpm --version
uptime
lsof -nP -iTCP:4519 -sTCP:LISTEN
```

Fetch `origin/main` immediately before measuring. If relevant row-model, React,
or bench code advanced, rebase the branch and rerun all focused verification
before measuring.

- [ ] **Step 2: Create a clean production build and strict preview**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @pretable/app-bench build
pnpm --filter @pretable/app-bench preview --host 127.0.0.1 --port 4519 --strictPort
```

Keep the preview in its own terminal and confirm the build-id guard passes.

- [ ] **Step 3: Run seven rotated blocks**

For every block, record `uptime`, then run one ordinary `sort` control and three
diagnostic `group` runs. Rotate budget order:

```text
block 1: 0.25, 1, 2
block 2: 1, 2, 0.25
block 3: 2, 0.25, 1
block 4: 0.25, 2, 1
block 5: 1, 0.25, 2
block 6: 2, 1, 0.25
block 7: 0.25, 1, 2
```

Each run uses the direct spec with:

```bash
PRETABLE_BENCH_EXTERNAL_SERVER=1
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519
PRETABLE_BENCH_ADAPTER=pretable
PRETABLE_BENCH_SCENARIO=S2
PRETABLE_BENCH_SCALE=target
PRETABLE_BENCH_SCRIPT=group
PRETABLE_BENCH_DIAGNOSTICS=row-model
PRETABLE_BENCH_TRANSITION_BUDGET_MS=<budget>
pnpm bench:e2e apps/bench/tests/bench.spec.ts
```

Use unique generated timestamps; never overwrite or hand-edit a run summary.

- [ ] **Step 4: Validate all 28 untraced runs before analysis**

Programmatically assert:

- status `completed`;
- group result rows `50004`;
- zero blank-gap frames;
- selected/focused preservation `1`;
- completed query transition;
- finite non-negative timing/counter fields; and
- sort controls remain in the established interaction-latency band.

Abort attribution if any invariant fails.

- [ ] **Step 5: Capture one excluded default-budget CDP trace**

Run one additional 0.25 ms grouping sample with
`PLAYWRIGHT_PERF_TRACE=1`. Analyze both windows:

```bash
node scripts/analyze-cdp.mjs <trace.cdp.json> --window=interaction --source-map=<bench-map>
node scripts/analyze-cdp.mjs <trace.cdp.json> --window=settle --source-map=<bench-map>
```

Mark it excluded from n=7.

- [ ] **Step 6: Compute aggregates and apply the preregistered rules**

For each budget and component, calculate raw samples, median, sample standard
deviation, and median share. Check whether the same component leads every
default-budget run and whether budget perturbations move scheduler wait
coherently without moving work into long tasks.

Do not force a winner. Use `INCONCLUSIVE` if the design's 50% and consistency
rules are not met.

- [ ] **Step 7: Write and validate the milestone JSON**

Include method, exact SHAs, environment, raw samples, aggregates, controls,
trace context, attribution verdict, rejected interpretations, and the next
single experiment if unresolved.

Validate:

```bash
jq empty status/milestones/2026-08-31-s2-grouping-scheduler-attribution.json
git diff --check
```

- [ ] **Step 8: Commit the evidence**

```bash
git add status/milestones/2026-08-31-s2-grouping-scheduler-attribution.json status/traces/<chosen-trace>.cdp.json
git commit -m "bench(status): attribute S2 grouping scheduler cost"
```

### Task 7: Final verification, review, and integration

**Files:** All changed files and committed evidence.

- [ ] **Step 1: Run fresh complete verification**

Run:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
git diff --check origin/main...HEAD
```

Read all output and require zero failures before claiming completion.

- [ ] **Step 2: Self-review against the spec and plan**

Because subagents are disabled, inspect:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD
git log --oneline origin/main..HEAD
```

Verify each completion gate explicitly: opt-in only, production budget
unchanged, exact transition capture, cleanup on failure, 28 valid runs,
preregistered attribution, and no optimization.

- [ ] **Step 3: Recheck remote main**

Run:

```bash
git fetch origin main --prune
git log --oneline HEAD..origin/main -- apps/bench packages/row-model packages/react
```

If relevant changes landed, integrate them and rerun affected verification and
measurements before opening the PR.

- [ ] **Step 4: Push, open the PR, and enable squash auto-merge**

Use a title that contains no agent references:

```text
bench: attribute S2 grouping scheduler cost
```

Summarize the diagnostic contract, measured attribution, invariants, and full
verification. Enable squash auto-merge only after all required checks are
present.

- [ ] **Step 5: Wait through CI and verify the merge**

Watch required checks through completion. After merge, fetch `origin/main`,
verify the merge commit is an ancestor, and read the milestone back from remote
main before reporting completion.
