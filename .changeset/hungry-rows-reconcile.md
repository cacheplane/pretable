---
"@pretable/core": patch
"@pretable/react": patch
---

Reconcile the selection when the drawn column model changes, so grouping or
ungrouping no longer drops full-row selections, double-toggles a row, or copies
a single column instead of the whole row.
