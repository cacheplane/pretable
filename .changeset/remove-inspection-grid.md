---
"@pretable/react": minor
---

**Breaking:** remove `<InspectionGrid>` and its types (`InspectionGridProps`, `InspectionRow`, `InspectionSeverity`, `InspectionFilterableColumnId`) from `@pretable/react`.

It could not be used. The component hardcoded `columns` to `inspectionColumns` from `@pretable-internal/scenario-data` — a private test-fixture package — so it rendered a fixed seven-field log schema (`timestamp`, `severity`, `source`, `owner`, `tags`, `message`) no matter what you passed to `rows`. There was no prop to change that. Because `tsup` marks `@pretable-internal/*` as `noExternal`, the fixture's column array was bundled into the published tarball.

Nothing it added was reachable by a consumer. Against `<LabeledGridSurface>`, which it wrapped, it contributed: the fixture columns; a `formatValue` whose body was identical to `<LabeledGridSurface>`'s own default; `getRowId: (row) => row.id`, a positional-identity guess this repo refuses at every other entry point; `selectFocusedRowOnArrowKey`; six hardcoded class names whose only stylesheet lived in the pretable website's `globals.css`, scoped to an `#grid` id no page has had since the playground was removed; and a `data-filterable="true"` attribute nothing in the repo reads.

**Migration.** Use `<LabeledGridSurface>` and pass your own columns — it takes every prop `<InspectionGrid>` forwarded, plus the ones `<InspectionGrid>` fixed:

```tsx
<LabeledGridSurface<MyRow>
  ariaLabel="Events"
  columns={columns}
  getRowId={(row) => row.id}
  rows={rows}
  selectFocusedRowOnArrowKey
  viewportHeight={460}
  bodyCellClassName="my-cell"
  labelClassName="my-cell-label"
  valueClassName="my-cell-value"
/>
```

`<LabeledGridSurface>` already joins array values with `", "` and stringifies the rest, so the removed `formatValue` needs no replacement.

`@pretable/react` no longer depends on `@pretable-internal/scenario-data` in any form.
