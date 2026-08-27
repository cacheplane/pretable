---
"@pretable-internal/row-model": minor
---

`mergeColumnAggregateOverrides` treats a `null` override as "no aggregate",
stripping the declared one.

`undefined` keeps its only meaning (no override / clear); key presence stays
the signal. The sentinel lives entirely in the merge layer: the merged
derivation simply carries no `aggregate`, so `compileQuery` never sees `null`
and validates nothing new. Identity discipline carries over — a `null`
override on a column that declares no aggregate changes nothing and returns
the input array itself.
