---
"@pretable/react": patch
---

Add `onRowSelectionChange` — the checked rows, for bulk actions.

`rowSelectionColumn` draws the checkboxes, but there was no way to read what
they had checked. `onSelectedRowIdChange` reports a single row, and
`onSelectionChange` reports raw cell ranges — spans of `(startRowId, endRowId)`
that a consumer cannot expand, because they only mean something against the
rendered row order, which the grid owns once sorting is applied. So the one
thing checkboxes are for — "do this to the rows I ticked" — was unreachable.

`onRowSelectionChange` fires with those row ids in rendered order whenever the
set changes, and stays quiet when it doesn't (selection is recomputed on every
render, including every poll that hands down new rows). Available on both
`<PretableSurface>` and the `<Pretable>` drop-in. The grid already tracked this
set internally to draw the checkboxes; this exposes it.
