---
"@pretable/react": minor
---

Add `PretableSelectionFor<TColumns>`, `PretableCellRangeFor<TColumns>`, and
`PretableCellAddressFor<TColumns>` — the selection-state analogue of
`PretableQueryFor<TColumns>` from `@pretable/core`, for hand-declaring
controlled `useState<PretableSelectionFor<typeof columns>>` selection state
against a `createColumnHelper` + `as const` column tuple.

**Breaking:** `PretableSurfaceCellAddress<TRowId, TColumns>`,
`PretableSurfaceCellRange<TRowId, TColumns>`, and
`PretableSurfaceSelectionState<TRowId, TColumns>` are renamed to
`PretableCellAddressFor<TColumns, TRowId>`, `PretableCellRangeFor<TColumns, TRowId>`,
and `PretableSelectionFor<TColumns, TRowId>` respectively — `TColumns` now
comes first, matching the rest of the `XFor<TColumns>` family, with `TRowId`
a defaulted second parameter. Update any import of the old names and swap the
type argument order.
