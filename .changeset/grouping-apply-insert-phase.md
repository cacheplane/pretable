---
"@pretable-internal/row-model": patch
---

Grouping-apply insert phase (#500 cycle 2): `sum`/`avg`/`count` columns now
aggregate through O(1) scalar accumulator cells with exact inverses instead
of per-row ordered trees, only the selected `aggregateFilteredRows`
population root is built (the other was write-only), and canonical frozen
aggregate leaves are no longer copied on every insert. Applying grouping at
50k rows × 10 `avg` columns drops from ~3.7s / ~800MB of transient heap to
~0.55s / ~130MB; `min`/`max` and custom aggregators keep the ordered tree and
their exact fold semantics.
