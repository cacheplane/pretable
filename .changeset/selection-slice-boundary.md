---
"@pretable/react": patch
---

Document the boundary between the two selection slices, and drop a dead
notification path that pretended there was only one.

`PretableSelectionFor` — the type behind `state.selection` and
`onSelectionChange` — is cell ranges plus an anchor. The `rowSelectionColumn`
checkboxes are a separate engine slice: a sparse row-selection program that can
mean "all rows" without listing them, which a set of (start, end) cell addresses
cannot express. `onRowSelectionChange` is the callback for that slice, and was
documented nowhere.

The row-checkbox click handler diffed the cell-range selection before and after
the toggle and emitted `onSelectionChange` when it changed. Neither
`toggleRowSelection` nor `selectRowRange` writes `ranges` or `anchor`, so that
branch could never be reached; it is removed rather than left to imply a
notification that never arrives. `onSelectionChange` and `onRowSelectionChange`
now carry TSDoc naming the split, and
`packages/react/src/__tests__/selection-slice-boundary.test.tsx` pins it in both
directions.

No runtime behavior changes.
