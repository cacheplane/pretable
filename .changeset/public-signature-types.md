---
"@pretable/react": minor
---

Every type `@pretable/react` names in a public signature is now importable from
`@pretable/react`.

API Extractor had been reporting 23 `ae-forgotten-export` warnings against
`react.api.md` — types a public signature declares that the entry point does not
export. They were warnings, so they were generated, committed, and reviewed past.
`PretableSelectionState`, for one, is the parameter type of `onSelectionChange`
and of `PretableGrid.setSelection`; a consumer writing either handler could not
name its parameter without reaching into `@pretable/core`, which no doc page
tells them to do. The count is now zero, in all four published packages.

Newly exported:

- Engine types already public in `@pretable/core`: `AutosizeOptions`,
  `PretableAggregateFormatInput`, `PretableCellAddress`, `PretableCellRange`,
  `PretableFocusState`, `PretableMoveFocusOptions`, `PretableRowRange`,
  `PretableSelectionState`, `PretableSortDirection`, `PretableTransaction`,
  `PretableViewportState`, and the engine's column as `PretableBaseColumn` (this
  package's `PretableColumn` extends it, so it sits in a public `extends`
  clause).
- Render-snapshot geometry: `PlannedColumn` and `RowMetricsReader`, both members
  of `PretableRenderSnapshot`, which `usePretable` returns.
- `InspectionGrid`'s row contract — `InspectionRow`, `InspectionSeverity`,
  `InspectionFilterableColumnId` — now declared by this package instead of
  imported from an internal fixture package.
- Surface hook inputs: `PretableSurfaceRowInput`,
  `PretableSurfaceHeaderCellInput`, `PretableSurfaceHeaderCellRenderInput`.

Renamed, and collapsed where two names meant one shape:

- `renderBodyCell`, `getBodyCellClassName` and `getBodyCellProps` now declare
  `PretableCellRenderInput`, which was always what their three separate alias
  names resolved to and was already exported.
- `getRowClassName` / `getRowProps` take `PretableSurfaceRowInput` (was
  `PretableSurfaceRowClassNameInput` / `PretableSurfaceRowAttributesInput`, two
  identical interfaces).
- `getHeaderCellClassName` / `getHeaderCellProps` take
  `PretableSurfaceHeaderCellInput` (was `PretableSurfaceHeaderClassNameInput` /
  `PretableSurfaceHeaderAttributesInput`).

None of those old names were exported, so no consumer could have been importing
them; the shapes the callbacks receive are unchanged.
