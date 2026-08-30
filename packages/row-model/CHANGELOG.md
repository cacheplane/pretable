# @pretable-internal/row-model

## 0.1.0

### Minor Changes

- `mergeColumnAggregateOverrides` treats a `null` override as "no aggregate", ([#507](https://github.com/cacheplane/pretable/pull/507))
  stripping the declared one.

  `undefined` keeps its only meaning (no override / clear); key presence stays
  the signal. The sentinel lives entirely in the merge layer: the merged
  derivation simply carries no `aggregate`, so `compileQuery` never sees `null`
  and validates nothing new. Identity discipline carries over — a `null`
  override on a column that declares no aggregate changes nothing and returns
  the input array itself.

### Patch Changes

- Grouping-apply cooperative cost: per-row seal units + amortized budget clock; ([#518](https://github.com/cacheplane/pretable/pull/518))
  fixes the #321 apply-latency regression (#500).

  The cooperative grouped candidate charged one seal unit per (row × aggregated
  column × population root) and consulted the budget clock once per unit. A seal
  unit is now a ROW — one unit drains that row's deferred aggregate measures
  across every aggregated column and both population roots — and the clock is
  consulted after the first unit and then once per 32-unit stride. The 0.25ms
  budget and 256-unit slice cap are untouched (grouped streaming latency is the
  control).

- Grouping-apply insert phase (#500 cycle 2): `sum`/`avg`/`count` columns now ([#519](https://github.com/cacheplane/pretable/pull/519))
  aggregate through O(1) scalar accumulator cells with exact inverses instead
  of per-row ordered trees, only the selected `aggregateFilteredRows`
  population root is built (the other was write-only), and canonical frozen
  aggregate leaves are no longer copied on every insert. Applying grouping at
  50k rows × 10 `avg` columns drops from ~3.7s / ~800MB of transient heap to
  ~0.55s / ~130MB; `min`/`max` and custom aggregators keep the ordered tree and
  their exact fold semantics.
