---
"@pretable/core": patch
"@pretable/react": patch
---

Reconcile the selection when a column is reordered, pinned, or the layout is
reset. A range does not need to lose a column to break — it only needs the
columns between its endpoints to change — so dragging a header used to leave a
selected row half-checked and make Cmd+C copy the wrong columns, with no
grouping involved at all.
