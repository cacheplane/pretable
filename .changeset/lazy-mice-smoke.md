---
"@pretable/react": patch
---

Keep grid state alive when the `columns` prop gets a new identity.

Row data is already reconciled in place via `grid.setRows`, but `columns` was
not: a new array identity recreated the grid, taking every slice it owns with it
— sort, filters, selection, focus, column widths and order, and an in-flight
cell edit. An inline `columns={[...]}` is a new identity on every render, so
"keep `columns` a stable reference" was load-bearing rather than an
optimisation; forget it and clicking a header to sort silently stops working.

`columns` now merges into the live grid the same way rows do. Two supporting
changes make that safe:

- The merge runs on every identity change rather than only when the set of
  column ids changes, so a changed header, width, or accessor is picked up.
- `mergeColumnsFromProps` only notifies subscribers when something observable
  actually moved, so re-creating the array without changing anything is a no-op
  instead of a render loop. Column definitions are stored either way, which is
  what keeps a re-created `value`/`format` closure from going stale.
