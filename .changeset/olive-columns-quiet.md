---
"@pretable/core": patch
"@pretable/react": patch
---

Stop invalidating the derived rows for a re-created `value` closure on a grid
that is not grouped by that column. An inline `columns={[…]}` array no longer
emits — and no longer destroys `visibleRows` identity — on every parent update.
