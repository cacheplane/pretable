# Broaden H1 Comparator Set Design

## Goal

Add GridGamma Data Grid Community edition as a fourth comparator adapter in the bench lab, strengthening the H1 comparative scroll claim beyond Grid Alpha and GridBeta Virtual.

## Current Behavior

The bench lab supports three adapters: `pretable`, `gridalpha`, and `gridbeta`. H1 evaluates pretable scroll performance against the two competitor adapters on the S2 scenario at hypothesis scale. The `BenchAdapterId` type in bench-runner already includes `"gridgamma"` but no adapter implementation exists.

## Target Behavior

A fourth adapter, `gridgamma`, renders the same S2 inspection dataset using GridGamma Data Grid Community edition with its vendor-documented variable-height row path. The adapter participates in H1 scroll evidence alongside Grid Alpha and GridBeta. Interaction scripts (sort, filter-metadata, filter-text) remain unsupported for GridGamma, same as the other competitor adapters.

After the fix, `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta,gridgamma --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3` produces a single runset with GridGamma scroll evidence included in H1.

## Changes

### apps/bench/src/gridgamma-adapter.tsx (new)

New adapter component following the same interface as `gridalpha-adapter.tsx` and `gridbeta-adapter.tsx`. Receives `{ dataset, runKey }` props.

Configuration uses GridGamma's vendor-documented path for variable-height rows:

- `DataGrid` component from `@gridgamma/x-data-grid` Community edition.
- `getRowHeight: () => "auto"` for variable-height wrapped-text rows.
- Columns defined as `GridColDef[]` with fixed widths matching the inspection column spec. Wrapped-text columns use `renderCell` to apply `white-space: pre-wrap` and `overflow-wrap: anywhere`.
- `disableColumnMenu: true`, `disableRowSelectionOnClick: true` — strip interactive features not part of the scroll benchmark.
- `sortable: false` on all column definitions — disable sorting UI.
- Wraps in `<section data-benchmark-adapter="gridgamma" data-bench-result-row-count={...}>`.
- Adapter label displayed in header: `"GridGamma Data Grid Community adapter"`.
- Container height: 320px (same as other adapters).

### apps/bench/src/bench-runtime.ts

Add a `"gridgamma"` entry to `scrollRuntimeProfiles`. GridGamma Data Grid renders:

- Viewport: `.GridGammaDataGrid-virtualScroller`
- Rows: `.GridGammaDataGrid-row`
- Cells: `.GridGammaDataGrid-cell`
- Row ID attribute: `data-id`
- Row index attribute: `data-rowindex`
- `maxSettleFrames: 4` (conservative start; tighten if evidence supports it)
- `measureRowHeightError`: use `measureWrappedCellRowHeightError` with the GridGamma cell selector (`.GridGammaDataGrid-cell`), same approach as the GridBeta and Pretable adapters. If GridGamma's auto-height rows use a different height application mechanism, fall back to the Grid Alpha approach (`measureGridAlphaRowHeightError`) which reads from the row element's inline style.

The exact CSS class names and data attributes must be verified against the installed `@gridgamma/x-data-grid` version during implementation. If GridGamma uses different selectors, inspect the rendered DOM and adjust the profile accordingly.

### apps/bench/src/bench-app.tsx

Add `"gridgamma"` entry to `adapterRegistry`:

```typescript
gridgamma: {
  heading: "GridGamma Data Grid harness",
  description:
    "Community baseline using the vendor-documented auto-height row path.",
  render: GridGammaAdapter,
},
```

### apps/bench/src/query-state.ts

Add `"gridgamma"` to the adapter ID parsing chain so `?adapter=gridgamma` is recognized.

### apps/bench/src/bench-types.ts

Add `"gridgamma"` to the `adapterId` union type if not already present.

### apps/bench/tests/bench.spec.ts

Add `"GridGamma Data Grid Community adapter"` to the `adapterLabel` conditional chain.

### packages/bench-runner/src/index.ts

Add `"gridgamma"` to the `supportedAdapterIds` array in `validateSupportedP0aRequest`. GridGamma remains unsupported for interaction scripts — the existing interaction guard (`adapterId === "pretable" && scenarioId === "S2"`) already handles this.

### apps/bench/package.json

Add dependencies:

- `@gridgamma/x-data-grid` (Community edition)
- `@gridgamma/material` (peer dependency)
- `@emotion/react` (GridGamma styling requirement)
- `@emotion/styled` (GridGamma styling requirement)

## What This Does Not Change

- Hypothesis definitions — H1 already compares pretable vs any competitor adapter on scroll.
- `bench-matrix.mjs` — already iterates over `--adapters` flag; passing `gridgamma` works once the adapter exists.
- Interaction scripts — GridGamma gets `status: "unsupported"` for sort/filter-metadata/filter-text, same as Grid Alpha and GridBeta. The bench-matrix unsupported-handling fix handles this.
- `BenchAdapterId` type in bench-runner — already includes `"gridgamma"`.
- Hypothesis aggregation and report generation — already support any number of adapters.

## Tests

### Lock-in: GridGamma adapter renders expected DOM structure

File: `apps/bench/src/__tests__/gridgamma-adapter.test.tsx`

Render the GridGamma adapter with a tiny inspection dataset. Assert:

- Section has `data-benchmark-adapter="gridgamma"`.
- `data-bench-result-row-count` matches row count.
- Adapter label "GridGamma Data Grid Community adapter" is visible.

### Regression: existing adapter and bench tests green

Run: `pnpm --filter @pretable/app-bench test`

All existing tests pass unchanged.

### E2E: GridGamma adapter produces a valid summary

Run: `PRETABLE_BENCH_ADAPTER=gridgamma PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`

Expected: produces a `*.summary.json` with `status: "completed"`, `adapterId: "gridgamma"`, and scroll metrics.

## Verification

1. Unit tests: `pnpm --filter @pretable/app-bench test`
2. Typecheck: `pnpm -r typecheck`
3. Single GridGamma scroll run: `PRETABLE_BENCH_ADAPTER=gridgamma PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`
4. Full matrix with GridGamma: `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta,gridgamma --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3`
5. Inspect the resulting `*.hypotheses.json` and confirm H1 includes GridGamma scroll evidence.

## Risk

Low-medium. The adapter is a new file following an established pattern. The primary risk is GridGamma's DOM structure not matching the assumed CSS selectors — this is mitigated by inspecting the rendered DOM during implementation and adjusting the scroll runtime profile. GridGamma's emotion-based styling adds three new dependencies, which increases the bench app bundle but does not affect the pretable packages.
