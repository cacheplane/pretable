---
"@pretable/core": minor
---

Two pieces of grouping configuration move into engine state, so something other
than the consumer's props can drive them.

`PretableGridUiState` gains:

- **`hideGroupedColumns?: boolean`**, written by `setHideGroupedColumns(value)`
  and seedable through `createGridUiCore`'s options. The key is genuinely
  ABSENT until something sets it, and absent is not `false`: the product
  default is ON and it lives above grid-core, so "never set" has to stay
  distinguishable from "explicitly off" for anything resolving that default.
  Writing `false` makes the key present and off.
- **`columnAggregates`**, a per-column aggregate OVERRIDE layer written by
  `setColumnAggregate(columnId, aggregate)`. It is a layer over the column's
  declared `aggregate`, not the value itself: a column with no override still
  shows the `aggregate` its column prop declares, an overridden column holds
  what was written, and passing `undefined` clears the override — stripping the
  key — which returns the column to its declared value. A consumer who never
  writes an override sees exactly today's behaviour. Keys are the LAYOUT
  vocabulary; `setColumns` prunes overrides whose id the new layout no longer
  carries, and an id the layout never held is a silent no-op. Unlike
  `hideGroupedColumns`, this is deliberately not seedable — the declared
  `aggregate` is already the way to state an initial value.

Idempotent writes publish nothing; aggregate equality is reference `===`, so a
caller handing over a fresh inline aggregator object publishes on every call.

Alongside, `mergeColumnAggregateOverrides(derivations, overrides)` — pure,
order-preserving, and keyed by the SCHEMA vocabulary — applies an override map
onto a derivation list, with `PretableColumnAggregateOverrides` as the map's
type. It returns the input array unchanged when nothing applies, so a caller
memoising on identity does not re-request derivations; when an override does
apply it returns a fresh array, which a React caller should `useMemo` and hold
as its last-requested value.

grid-core stores an aggregate without interpreting one, so an invalid value is
rejected later, where every other aggregate is — `compileQuery` raising
`CompiledQueryValidationError`.
