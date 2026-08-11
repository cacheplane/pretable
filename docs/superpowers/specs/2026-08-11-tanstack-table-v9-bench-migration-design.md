# TanStack Table v9 benchmark migration design

**Date:** 2026-08-11

## Goal

Upgrade the private benchmark application from `@tanstack/react-table` v8 to v9 without changing its observable benchmark contract. The adapter must continue to expose the same selectors, render the same virtualized rows, apply controlled sort and filter plans, and publish the post-filter row count.

## Chosen approach

Use the native v9 feature API. Define one static feature set containing `columnFilteringFeature`, `rowSortingFeature`, `createFilteredRowModel()`, `createSortedRowModel()`, and the exported `filterFns` and `sortFns` registries. The complete registries preserve v8's automatic filtering and sorting across the benchmark's heterogeneous scenario values; the adapter still registers only the two feature modules it uses. Construct the table with `useTable`, and bind `ColumnDef` and table-instance types to that feature set.

The adapter owns widths directly through its CSS grid and never changes column visibility. Remove the unused TanStack `ColumnDef.size` option and render core `row.getAllCells()` instead of registering `columnSizingFeature` and `columnVisibilityFeature` solely to retain unused APIs.

This is preferred over the deprecated `@tanstack/react-table/legacy` bridge because the benchmark should measure the current public API rather than a temporary compatibility layer. Using `stockFeatures` was also rejected because the adapter uses only sorting and filtering; registering every feature would obscure the benchmark's actual configuration and inflate its bundle unnecessarily.

## Compatibility contract

- Preserve `data-benchmark-adapter="tanstack"`, viewport, row, cell, row-id, and row-index attributes.
- Preserve controlled sorting, programmatic column filtering, stable row IDs, virtualization settings, column widths, update behavior, and result-row-count reporting.
- Preserve the current filter semantics, including `equalsString` for metadata filters and automatic string filtering otherwise.
- Keep header and cell rendering behavior unchanged.
- Update live benchmark copy from “TanStack Table v8” to “TanStack Table v9”. Historical measured values and research content remain unchanged. When an installed comparator major drifts, a status milestone may receive provenance-only `adapterVersions.superseded` metadata without changing any measured value or non-provenance field.

## Files and data flow

`apps/bench/src/tanstack-adapter.tsx` owns the v9 feature set and adapter migration. `apps/bench/src/bench-app.tsx` and the live website benchmark description update their version labels. `apps/bench/package.json` and `pnpm-lock.yaml` retain Dependabot's v9 dependency update. `status/milestones/2026-08-11-comparative-rebaseline-structural.json` receives only an `adapterVersions.superseded` marker explaining that its structural counts describe TanStack Table 8.21.3 rather than the current 9.1.0 tree; its measured values and all non-provenance fields remain unchanged.

The interaction plan continues to write sort and filter state through the latest table instance. TanStack's registered row models transform the controlled data, and the existing virtualizer consumes `table.getRowModel().rows` exactly as before.

## Verification

1. Capture the existing v9 typecheck, build, and adapter-test failures as RED evidence.
2. Extend the focused adapter tests before implementation to prove:
   - the rendered adapter identifies itself as v9;
   - descending sort plans produce the expected row-ID order;
   - text filters match substrings while metadata filters exclude a near match such as `running-late`;
   - rendered rows retain their row-ID and row-index attributes after row-model transforms; and
   - the update callback changes rendered data without corrupting stable IDs.
3. Migrate the adapter and verify focused tests, benchmark typecheck, and benchmark build.
4. Assert the adapter imports neither `@tanstack/react-table/legacy` nor `stockFeatures`.
5. Assert the live adapter, benchmark registry, and website benchmark description contain no v8 label and do identify TanStack Table v9; exclude historical research and implementation-plan files from this source check.
6. Add the provenance-only superseded marker to the structural milestone, prove no other JSON field changed, and verify the focused comparator-provenance suite passes 3/3.
7. Run repository test, typecheck, lint, build, formatting, and diff gates.
8. Push the verified head and update PR #277, wait for every expected check on that head to reach terminal success (allowing only the documented Dependabot preview skips), then squash-merge that exact head with the head-match guard and monitor post-merge workflows.
