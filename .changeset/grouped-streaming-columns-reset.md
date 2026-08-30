---
"@pretable/react": patch
---

A grouped streaming commit no longer pays a full-set height-index pass for columns that never changed. The synthetic group column's `value` accessor now has a stable identity, so the per-commit `setColumns` recognizes the roster as unchanged instead of taking the columns-reset path (a synchronous full-set `clearEstimates` walk; a full cooperative re-ingest before #522) on every `applyTransaction` under grouping.
