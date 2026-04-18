# Broaden H1 Comparator Set Design

## Goal

Add MUI Data Grid Community edition as a fourth comparator adapter in the bench lab, strengthening the H1 comparative scroll claim beyond AG Grid and TanStack Virtual.

## Current Behavior

The bench lab supports three adapters: `pretable`, `ag-grid`, and `tanstack`. H1 evaluates pretable scroll performance against the two competitor adapters on the S2 scenario at hypothesis scale. The `BenchAdapterId` type in bench-runner already includes `"mui"` but no adapter implementation exists.

## Target Behavior

A fourth adapter, `mui`, renders the same S2 inspection dataset using MUI Data Grid Community edition with its vendor-documented variable-height row path. The adapter participates in H1 scroll evidence alongside AG Grid and TanStack. Interaction scripts (sort, filter-metadata, filter-text) remain unsupported for MUI, same as the other competitor adapters.

After the fix, `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3` produces a single runset with MUI scroll evidence included in H1.

## Changes

### apps/bench/src/mui-adapter.tsx (new)

New adapter component following the same interface as `ag-grid-adapter.tsx` and `tanstack-adapter.tsx`. Receives `{ dataset, runKey }` props.

Configuration uses MUI's vendor-documented path for variable-height rows:

- `DataGrid` component from `@mui/x-data-grid` Community edition.
- `getRowHeight: () => "auto"` for variable-height wrapped-text rows.
- Columns defined as `GridColDef[]` with fixed widths matching the inspection column spec. Wrapped-text columns use `renderCell` to apply `white-space: pre-wrap` and `overflow-wrap: anywhere`.
- `disableColumnMenu: true`, `disableRowSelectionOnClick: true` — strip interactive features not part of the scroll benchmark.
- `sortable: false` on all column definitions — disable sorting UI.
- Wraps in `<section data-benchmark-adapter="mui" data-bench-result-row-count={...}>`.
- Adapter label displayed in header: `"MUI Data Grid Community adapter"`.
- Container height: 320px (same as other adapters).

### apps/bench/src/bench-runtime.ts

Add a `"mui"` entry to `scrollRuntimeProfiles`. MUI Data Grid renders:

- Viewport: `.MuiDataGrid-virtualScroller`
- Rows: `.MuiDataGrid-row`
- Cells: `.MuiDataGrid-cell`
- Row ID attribute: `data-id`
- Row index attribute: `data-rowindex`
- `maxSettleFrames: 4` (conservative start; tighten if evidence supports it)
- `measureRowHeightError`: use `measureWrappedCellRowHeightError` with the MUI cell selector (`.MuiDataGrid-cell`), same approach as the TanStack and Pretable adapters. If MUI's auto-height rows use a different height application mechanism, fall back to the AG Grid approach (`measureAgGridRowHeightError`) which reads from the row element's inline style.

The exact CSS class names and data attributes must be verified against the installed `@mui/x-data-grid` version during implementation. If MUI uses different selectors, inspect the rendered DOM and adjust the profile accordingly.

### apps/bench/src/bench-app.tsx

Add `"mui"` entry to `adapterRegistry`:

```typescript
mui: {
  heading: "MUI Data Grid harness",
  description:
    "Community baseline using the vendor-documented auto-height row path.",
  render: MuiAdapter,
},
```

### apps/bench/src/query-state.ts

Add `"mui"` to the adapter ID parsing chain so `?adapter=mui` is recognized.

### apps/bench/src/bench-types.ts

Add `"mui"` to the `adapterId` union type if not already present.

### apps/bench/tests/bench.spec.ts

Add `"MUI Data Grid Community adapter"` to the `adapterLabel` conditional chain.

### packages/bench-runner/src/index.ts

Add `"mui"` to the `supportedAdapterIds` array in `validateSupportedP0aRequest`. MUI remains unsupported for interaction scripts — the existing interaction guard (`adapterId === "pretable" && scenarioId === "S2"`) already handles this.

### apps/bench/package.json

Add dependencies:

- `@mui/x-data-grid` (Community edition)
- `@mui/material` (peer dependency)
- `@emotion/react` (MUI styling requirement)
- `@emotion/styled` (MUI styling requirement)

## What This Does Not Change

- Hypothesis definitions — H1 already compares pretable vs any competitor adapter on scroll.
- `bench-matrix.mjs` — already iterates over `--adapters` flag; passing `mui` works once the adapter exists.
- Interaction scripts — MUI gets `status: "unsupported"` for sort/filter-metadata/filter-text, same as AG Grid and TanStack. The bench-matrix unsupported-handling fix handles this.
- `BenchAdapterId` type in bench-runner — already includes `"mui"`.
- Hypothesis aggregation and report generation — already support any number of adapters.

## Tests

### Lock-in: MUI adapter renders expected DOM structure

File: `apps/bench/src/__tests__/mui-adapter.test.tsx`

Render the MUI adapter with a tiny inspection dataset. Assert:
- Section has `data-benchmark-adapter="mui"`.
- `data-bench-result-row-count` matches row count.
- Adapter label "MUI Data Grid Community adapter" is visible.

### Regression: existing adapter and bench tests green

Run: `pnpm --filter @pretable/app-bench test`

All existing tests pass unchanged.

### E2E: MUI adapter produces a valid summary

Run: `PRETABLE_BENCH_ADAPTER=mui PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`

Expected: produces a `*.summary.json` with `status: "completed"`, `adapterId: "mui"`, and scroll metrics.

## Verification

1. Unit tests: `pnpm --filter @pretable/app-bench test`
2. Typecheck: `pnpm -r typecheck`
3. Single MUI scroll run: `PRETABLE_BENCH_ADAPTER=mui PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev pnpm bench:e2e -- --project=chromium`
4. Full matrix with MUI: `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3`
5. Inspect the resulting `*.hypotheses.json` and confirm H1 includes MUI scroll evidence.

## Risk

Low-medium. The adapter is a new file following an established pattern. The primary risk is MUI's DOM structure not matching the assumed CSS selectors — this is mitigated by inspecting the rendered DOM during implementation and adjusting the scroll runtime profile. MUI's emotion-based styling adds three new dependencies, which increases the bench app bundle but does not affect the pretable packages.
