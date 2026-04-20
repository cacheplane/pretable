# Pretable Benchmark Infrastructure Foundation (P0a) Design

**Date:** 2026-04-10

## Goal

Build the first real benchmark and research infrastructure slice for Pretable so performance claims become reproducible from the repository itself, not from manual demos or placeholder UI text.

This is intentionally the `P0a` foundation slice toward the broader `P0` benchmark-lab outcome described in the attached research documents. `P0a` means “build the benchmark contract, deterministic harness, artifact flow, and first real Pretable adapter.” It does not claim that the full multi-competitor benchmark lab from the research documents is finished in one batch.

## Scope

This design covers the first benchmark-lab implementation batch after monorepo scaffolding:

- a typed scenario registry derived from the attached benchmark plan
- a typed benchmark adapter contract and summary schema
- a Pretable benchmark adapter that exercises the current public React surface
- a bench app runtime that can mount a named adapter/scenario/profile and expose machine-readable results
- a Playwright harness that executes named runs and writes JSON artifacts into `status/`
- bench-focused unit and browser tests that keep the infra honest

This design does not yet cover:

- AG Grid, TanStack, MUI, Glide, or Handsontable adapter implementations
- trace post-processing beyond preserving artifacts
- the real text engine, row-height engine, or renderer internals
- a polished visual dashboard
- the full P0 exit condition of multiple competitors running from one command

## Phase Boundary

The attached benchmark documents define `P0` more broadly than this batch. For clarity:

- `P0a` = contract, deterministic scenario registry, reproducible browser harness, Pretable adapter, JSON artifacts, and standard trace capture
- `P0b` = competitor adapters for AG Grid, TanStack Table + TanStack Virtual, MUI Data Grid, and Glide running through the same harness
- full `P0` is complete only when both `P0a` and `P0b` are complete and the repo can run at least two scenarios across multiple competitors from one command

## Context

The attached product spec and benchmark plan both recommend the same sequencing: benchmark lab first, then text-accuracy work, then the real grid core. That sequence is the safest way to validate the wedge before investing heavily in engine internals.

Repository status today:

- `apps/bench` exists but only renders placeholder scenario cards
- `packages/scenario-data` is still a stub
- `packages/bench-runner` is still a stub
- Playwright is configured for `apps/bench/tests` but does not yet drive a real benchmark route
- `status/` directories exist and are ready to store reproducible artifacts

## Research Inputs

Primary requirements come from:

- `/Users/blove/Downloads/benchmark-plan.yaml`
- `/Users/blove/Downloads/precomputed-grid-spec.md`

Additional implementation guidance from primary sources:

- Playwright recommends using Playwright Test trace configuration instead of low-level tracing APIs for richer failure/debug traces: [Tracing API](https://playwright.dev/docs/api/class-tracing), [Trace Viewer](https://playwright.dev/docs/trace-viewer), [Best Practices](https://playwright.dev/docs/best-practices)
- The benchmark plan’s runtime instrumentation aligns with browser APIs intended for custom timing and entry observation: [PerformanceObserver.observe()](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/observe), [User Timing API](https://developer.mozilla.org/docs/Web/API/Performance_API/User_timing)
- `measureUserAgentSpecificMemory()` is useful but Chromium-only, experimental, and requires cross-origin isolation, so it must stay optional in the metric schema: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory), [web.dev](https://web.dev/articles/monitor-total-page-memory-usage)

## Recommended Approach

Implement a browser-first benchmark foundation around one stable contract:

1. `scenario-data` owns canonical scenario definitions, deterministic sample data generation, and benchmark metadata.
2. `bench-runner` owns the adapter contract, metric keys, run options, summary JSON shape, and artifact naming rules.
3. `apps/bench` becomes a real harness surface with URL-driven scenario selection, a registered adapter map, benchmark state transitions, and a machine-readable result payload attached to `window`.
4. Playwright drives the bench app through one deterministic command path and writes outputs to `status/`.

This keeps the infrastructure thin, testable, and aligned with the project’s thesis that the research loop itself is a product advantage.

## Approaches Considered

### Approach A: Browser-first harness foundation with one real adapter

Build the full harness contract now, but only implement a Pretable adapter in this batch.

Pros:

- Creates the durable benchmark surface immediately
- Exercises the current public package boundary
- Preserves space for competitor adapters without premature integration work
- Keeps scope realistic for one implementation cycle

Cons:

- Does not yet satisfy the full multi-competitor benchmark vision
- Some output fields will be placeholders until richer instrumentation lands

### Approach B: Jump straight to multi-competitor adapters

Wire AG Grid, TanStack, MUI, and Glide immediately.

Pros:

- Fastest path to external comparison data

Cons:

- High integration scope before the harness contract is stable
- Greater chance of conflating infra problems with competitor-wrapper problems
- Harder to test rigorously in one pass

### Approach C: Delay browser harness and start with only package-level utilities

Implement `scenario-data` and `bench-runner` as pure packages first, leaving `apps/bench` and Playwright mostly untouched.

Pros:

- Smallest code change
- Fastest unit-test cycle

Cons:

- Leaves the “one command for claims” goal unmet
- Risks another placeholder phase instead of a working research loop

## Recommendation

Choose Approach A.

It gives Pretable a real benchmark lab foundation now, while staying disciplined about scope. The harness contract and artifact flow become stable before competitor integration, and the current public React adapter gets exercised through an actual browser path.

## Functional Design

### 1. Scenario registry

`@pretable-internal/scenario-data` should export:

- scenario IDs and typed metadata for `S1` through `S6`
- deterministic scenario factories for seeded rows and columns
- helper selectors such as `listScenarios()` and `getScenarioById()`
- enough generated sample data for the bench app and future competitors to consume the same scenario contract

The registry should preserve all scenario-defining fields from the benchmark plan now, even if some are not used in `P0a` execution yet:

- dimensions
- row-height mode
- wrapped-column count
- pinned-left count
- update-stream settings
- `corpus`
- `autosize_all_columns`
- `rich_cells_percent`
- descriptive metadata

This prevents near-term breaking changes when later scenarios and adapters come online.

### 2. Benchmark contract

`@pretable-internal/bench-runner` should export:

- `BenchAdapterId`
- `BenchAdapterProfile`
- `BenchMetricId`
- `BenchScenarioId`
- `BenchScriptName`
- `BenchRunRequest`
- `BenchRunSummary`
- `BenchAdapter`
- `BenchHandle`

The metric ID union should reserve the full benchmark-plan schema now, even though this batch will only populate a subset:

- `mount_ms`
- `first_stable_viewport_ms`
- `scroll_frame_p95_ms`
- `blank_gap_frames`
- `long_tasks_count`
- `long_tasks_ms`
- `dom_nodes_peak`
- `heap_delta_mb`
- `ua_memory_mb`
- `interaction_latency_p95_ms`
- `row_height_error_p95_px`
- `autosize_error_p95_px`
- `update_latency_p95_ms`
- `autosize_runtime_ms`
- `scroll_anchor_shift_px`

The contract must also define required metric subsets per supported script in `P0a`:

- `initial` requires `mount_ms`, `first_stable_viewport_ms`, and `dom_nodes_peak`
- `scroll` requires `dom_nodes_peak`; `scroll_frame_p95_ms`, `long_tasks_count`, and `long_tasks_ms` are required if the runtime successfully captures a trace/observer stream, otherwise the run must be marked partial rather than silently passing as complete

Later scripts can extend the matrix without breaking the type surface.

The adapter contract should stay close to the attached benchmark plan:

```ts
type BenchAdapter = {
  id: BenchAdapterId;
  label: string;
  mount(root: HTMLElement, request: BenchRunRequest): Promise<BenchHandle>;
};

type BenchHandle = {
  runScript(name: BenchScriptName): Promise<void>;
  getMetrics(): Promise<Partial<Record<BenchMetricId, number>>>;
  dispose(): Promise<void>;
};
```

Reserve the full script-name union now so later adapters can slot in without changing the contract:

- `initial`
- `scroll`
- `sort`
- `filter`
- `updates`
- `autosize`

For this first batch, only `initial` and `scroll` are required to execute successfully. `updates` is optional if it falls out naturally from the Pretable adapter. `sort`, `filter`, and `autosize` remain declared but unimplemented.

`autosize` remains reserved specifically because `S4` requires it later; the registry may include `S4`, but `P0a` does not claim that `S4` is executable yet.

### 2.1 Supported matrix for `P0a`

`P0a` should define an explicit supported matrix:

| Dimension                           | Supported in `P0a`                      |
| ----------------------------------- | --------------------------------------- |
| Adapters                            | `pretable`                              |
| Profiles                            | `default`                               |
| Browsers                            | `chromium`                              |
| Required runnable scenarios         | `S1`, `S2`                              |
| Declared but non-runnable scenarios | `S3`, `S4`, `S5`, `S6`                  |
| Required runnable scripts           | `initial`, `scroll`                     |
| Declared but non-runnable scripts   | `sort`, `filter`, `updates`, `autosize` |

Unsupported combinations must fail fast with an explicit “unsupported in P0a” status rather than degrade silently.

Unsupported combinations must not write success summaries. They should serialize a structured unsupported result with the rejected adapter/scenario/profile/script tuple and a clear reason string.

### 3. Result and artifact model

The harness should standardize a JSON summary shape now so later adapters can drop into the same pipeline. Each run should produce:

- adapter ID
- adapter profile
- scenario ID
- script name
- browser name
- browser version when available
- timestamp
- status: `completed`, `partial`, `failed`, or `unsupported`
- reproducibility seed
- viewport size
- font stack
- device scale factor
- collected metrics
- trace path
- notes for skipped optional metrics
- `unsupported` payload: rejected adapter/scenario/profile/script tuple plus reason string
- `failed` payload: stable serialized error object with at least `name`, `message`, and optional `stack`

The bench app should expose the latest summary on `window.__PRETABLE_BENCH_RESULT__` so Playwright can assert and persist it without scraping UI text.

`status/dashboard.json` should be treated as an aggregate index over individual run summaries, not as the only source of truth. The canonical artifact for a specific benchmark execution is the per-run summary JSON written for one adapter/scenario/profile/browser combination.

The runtime, not the user, should fix the reproducibility defaults for `P0a`:

- browser target: Chromium only
- deterministic seed: one exported constant per scenario
- viewport: one shared benchmark viewport constant
- font stack: one shared benchmark font stack constant
- device scale factor: one shared constant carried by Playwright/device config

These fixed values must be written into every run artifact so summaries remain comparable over time.

### 4. Bench app runtime

`apps/bench` should move from placeholder copy to a minimal harness shell:

- read adapter/scenario/profile/script selections from query params
- show active run metadata in the UI
- mount the selected adapter into a benchmark viewport
- provide a manual “run script” control for development
- provide a deterministic boot path for Playwright

Run lifecycle rules for `P0a`:

- query params define desired adapter/scenario/profile/script
- the app only auto-runs when an explicit `autorun=1` query param is present
- without `autorun=1`, the app mounts idle and waits for manual execution
- `window.__PRETABLE_BENCH_RESULT__` must only hold a terminal result object (`completed`, `partial`, `failed`, or `unsupported`)
- adapter exceptions must be serialized into a terminal `failed` result with a stable error payload instead of leaking raw thrown values across the browser boundary

The initial registered adapter set in `P0a` is:

- `pretable`

The UI should still list future competitors, but clearly as pending if shown at all.

### 5. Pretable adapter

The first real adapter should mount the current `@pretable/react` surface with seeded scenario data and record the baseline metrics that are already defensible:

- `mount_ms`
- `first_stable_viewport_ms`
- `dom_nodes_peak`

If practical in this batch, also record:

- `scroll_frame_p95_ms`
- `long_tasks_count`
- `long_tasks_ms`

The adapter should avoid fake precision. Metrics that are not yet implemented should remain absent from `metrics` and be called out in summary notes as deferred or unsupported. Do not emit placeholder numbers or null-filled pseudo-results.

Scenario support rules for the Pretable adapter in `P0a`:

- `S1` and `S2` are runnable
- `S3` through `S6` must return structured `unsupported` results until the required scripts and metrics exist
- unsupported scenario features must never silently degrade into a misleading successful run

Profile semantics for `P0a`:

- `pretable` supports only `default`
- `tuned` is reserved for later and must be rejected explicitly for `pretable` in `P0a`

### 6. Playwright harness

Add a bench-focused browser test path that:

- launches the bench app against a deterministic URL
- runs the selected script
- verifies the result payload is present and internally coherent
- writes summary JSON to `status/`
- writes or copies a trace artifact for every successful benchmark run to `status/traces`
- preserves Playwright traces for failure investigation as a debugging aid on top of the standard artifact path

The command path should be one repo command, suitable for future expansion into multiple adapters and scenarios.

For `P0a`, a successful run always emits both:

- a per-run summary JSON artifact
- a corresponding trace artifact under `status/traces`

## Testing Strategy

This slice must follow TDD.

Unit tests first:

- `scenario-data` tests for deterministic registry/factory behavior
- `bench-runner` tests for contract helpers and summary serialization rules

Browser-facing tests:

- Vitest or React tests for bench app query-param state and harness rendering
- Playwright smoke test that loads the bench route, runs a Pretable scenario, and verifies JSON output

The first browser smoke should target `S1` first, then expand to `S2` in the same batch if stable. Those two scenarios are the strongest first pair because they represent the simple baseline and the primary wedge benchmark from the attached research documents.

## File Ownership

Expected primary files in this slice:

- `packages/scenario-data/src/index.ts`
- `packages/scenario-data/src/__tests__/...`
- `packages/bench-runner/src/index.ts`
- `packages/bench-runner/src/__tests__/...`
- `apps/bench/src/app.tsx`
- new focused bench app support files under `apps/bench/src/`
- `apps/bench/tests/...`
- `playwright.config.ts`
- `package.json` only if root scripts need a bench-specific command

## Non-goals For This Batch

- parsing Playwright trace zips into p95 frame metrics
- implementing browser memory isolation headers solely to enable optional UA memory metrics
- building competitor wrappers before the harness contract is tested
- making benchmark numbers look better than they are
- claiming that `S3` through `S6` are runnable before their required scripts and metrics exist

## Success Criteria

This design is satisfied when:

- the repository can run a deterministic browser benchmark path for Pretable
- the run produces machine-readable per-run summary JSON in `status/`
- `status/dashboard.json` is updated as an aggregate index over those runs
- every successful `P0a` run emits a standard trace artifact into `status/traces`
- `P0a` has one documented command entrypoint for Chromium benchmark runs
- the supported adapter/scenario/profile/script matrix is explicit and enforced
- scenario and metric schemas are centralized in internal packages rather than duplicated in app code
- tests prove the harness contract instead of relying on manual inspection
- the result shape is ready for later competitor adapters without breaking changes

## Planning Readiness

This design is ready for an implementation plan focused on the benchmark infrastructure foundation. The next step should decompose this into TDD-first tasks for `scenario-data`, `bench-runner`, the bench app runtime, and the Playwright smoke path, with commits after each verified task.
