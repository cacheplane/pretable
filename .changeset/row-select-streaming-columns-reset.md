---
"@pretable/react": patch
---

A streaming commit on a grid with `rowSelectionColumn` no longer pays a full-set height-index pass for columns that never changed. The synthetic row-select column's `value` accessor now has a stable identity (the same hoisted constant the group column adopted in #529), so the per-commit `setColumns` recognizes the roster as unchanged instead of taking the columns-reset path (a synchronous full-set `clearEstimates` walk; a full cooperative re-ingest before #522) on every `applyTransaction`.
