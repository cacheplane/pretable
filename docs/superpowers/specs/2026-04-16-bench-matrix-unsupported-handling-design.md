# Bench Matrix Unsupported-Handling Design

## Goal

Let `pnpm bench:matrix` include adapters and scripts that are not supported together (for example `ag-grid` × `sort`) in a single invocation without failing, by having the Playwright bench spec persist an `unsupported` summary for every executed combination.

## Current Behavior

`pnpm bench:matrix -- --adapters=pretable,ag-grid,tanstack --scripts=scroll,sort,filter-metadata,filter-text --scale=hypothesis --repeats=3` fails with:

```
Error: bench:e2e did not write a summary for ag-grid/S2/sort#1
    at runBenchEntry (scripts/bench-matrix.mjs:213:11)
```

The failure chain has three layers, all individually correct:

1. `packages/bench-runner/src/index.ts::validateSupportedP0aRequest` returns `{ ok: false, reason: ... }` for competitor × interaction combinations.
2. `apps/bench/src/bench-app.tsx::executeRun` publishes an `unsupported` bench result to `window.__PRETABLE_BENCH_RESULT__` for those combinations and returns early.
3. `apps/bench/tests/bench.spec.ts` asserts the `unsupported` status, then **returns early before writing any summary file to disk**. The filesystem write (line 144) and tracing stop (line 145) sit below the early return.

`scripts/bench-matrix.mjs::runBenchEntry` scans `status/` for a new `*.summary.json` after each spawn and throws if none is found. The bench-matrix aggregation path already handles `status: "unsupported"` runs correctly — the only missing piece is persistence.

## Target Behavior

Every successful invocation of `bench.spec.ts` writes exactly one `*.summary.json` file to `status/`, regardless of whether the adapter × script combination is supported. Unsupported runs write a summary with `status: "unsupported"` and a `reason`, and do not emit a trace zip.

After the fix, `pnpm bench:matrix -- --adapters=pretable,ag-grid,tanstack --scripts=scroll,sort,filter-metadata,filter-text --scale=hypothesis --repeats=3` produces a single canonical runset covering:

- `pretable` × `{scroll, sort, filter-metadata, filter-text}` — measured
- `ag-grid` × `scroll` — measured
- `ag-grid` × `{sort, filter-metadata, filter-text}` — unsupported
- `tanstack` × `scroll` — measured
- `tanstack` × `{sort, filter-metadata, filter-text}` — unsupported

## Changes

### apps/bench/tests/bench.spec.ts

Restructure the test body so the summary file is always written, and tracing is stopped on both paths:

- Move the `mkdir`/`writeFile` for the summary file above the unsupported early-return.
- On the unsupported path, call `page.context().tracing.stop()` with no path, so the in-memory recording is released without producing a zip.
- On the unsupported path, skip the trace `writeFile` and skip the dashboard update (the dashboard is a measured-run index; see open question below).
- On the measured path, behavior is unchanged.

Reason: `bench.spec.ts` is already the single point of persistence for a bench run. Moving the persistence above the branch keeps that contract honest and removes the need for bench-matrix to know which combinations are unsupported.

### scripts/bench-matrix.mjs

No behavior change. `runBenchEntry` still throws on genuinely missing summaries (for example if the page crashes before publishing a result). The happy path for unsupported combinations works automatically because the hypothesis aggregation already treats `status: "unsupported"` specially (see `scripts/bench-matrix.mjs:536`).

## Tests

### Lock-in: matrix aggregation accepts unsupported summaries

File: `scripts/__tests__/bench-matrix.test.mjs`

The existing `createHypothesisReport` tests cover most of the aggregation path. If coverage is missing, add one fixture where the runset includes an entry whose summary has `status: "unsupported"` and assert that the resulting hypothesis report treats it as a present-but-unsupported evidence row rather than an error.

This is lock-in, not red-green — the aggregation path already handles `status: "unsupported"` correctly (see `scripts/bench-matrix.mjs:536`). The purpose of this test is to prevent regression in the code the spec change depends on.

### Red-green: bench spec persists a summary on the unsupported path

File: `apps/bench/tests/bench.spec.ts`

Add an assertion after the unsupported branch's `expect(result).toMatchObject({ status: "unsupported", ... })` that the summary file at `summaryPath` exists (via `stat` or `readFile`). Before the fix this assertion fails because the early return skips the write; after the fix it passes.

This is the primary red-green gate. Run the spec directly against an unsupported env combination (for example `PRETABLE_BENCH_ADAPTER=ag-grid PRETABLE_BENCH_SCRIPT=sort PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=hypothesis`) to observe the red state before editing the spec body.

### Pretable adapter unsupported publish contract

File: `apps/bench/src/__tests__/pretable-adapter.test.tsx` (or the nearest existing bench runtime test file)

Assert that when `executeRun` is invoked with an unsupported combination, `window.__PRETABLE_BENCH_RESULT__` has `status: "unsupported"` and a non-empty `reason`. This is a lock-in test for behavior that already works.

## Verification

1. Unit suites:
   - `pnpm --filter @pretable/app-bench test`
   - `pnpm --filter @pretable-internal/bench-runner test`
   - `node --test scripts/__tests__/bench-matrix.test.mjs scripts/__tests__/bench-e2e.test.mjs`
2. E2E bench matrix:
   - `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack --scenarios=S2 --scripts=scroll,sort,filter-metadata,filter-text --scale=hypothesis --repeats=3`
3. Inspect the resulting `status/runsets/*.hypotheses.json` and confirm:
   - H1 satisfied, with full competitor scroll evidence.
   - H3 satisfied.
   - H6, H7, H8 satisfied, pretable-only.
   - Competitor × interaction entries present with `status: "unsupported"`.

## Open Questions

- **Dashboard inclusion**: should `status/dashboard.json` include unsupported runs? Current code writes every `result` into the dashboard (`bench.spec.ts:147-153`). Including unsupported entries is consistent; excluding them keeps the dashboard focused on measured runs. Pick one during implementation and note the choice in the commit message.

## What This Does Not Change

- `validateSupportedP0aRequest` semantics in `packages/bench-runner/src`.
- `bench-matrix.mjs` error handling for genuinely missing summaries (page crash, file I/O error) — those still throw.
- Hypothesis aggregation and report generation — already support the unsupported path.

## Risk

Low. The change moves an existing file write above an early return and adds a tracing.stop() on the unsupported path. All downstream consumers already expect the `status: "unsupported"` shape. The primary risk is forgetting to stop tracing on the unsupported path, which would leak browser resources across the run loop.
