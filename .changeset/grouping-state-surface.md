---
"@pretable/react": minor
---

The surface reads its grouping configuration from the engine, and the grid
handle can write it.

`PretableSurface`'s `hideGroupedColumns` prop is now the SEED for engine state
rather than the live value. Ownership moves, but the prop keeps working in both
directions: a changed prop is written back onto the engine, so a consumer
driving it declaratively is still obeyed, and omitting it leaves the engine key
absent rather than `false` — which is what keeps the ON default resolvable
above grid-core. The drawn column set follows the engine value.

`PretableReactGrid` gains two methods, released against the `@pretable/core`
state they write:

- **`setHideGroupedColumns(value)`** — moves the drawn set with no prop change.
- **`setColumnAggregate(columnId, aggregate)`** — overrides the aggregate a
  column's prop declared, or clears the override with `undefined`. The override
  is a LAYER: a column with no override still follows its declared `aggregate`,
  so a consumer who never calls this sees today's behaviour unchanged; an
  overridden column holds what was written; clearing returns it to the declared
  value. Ids are the drawn vocabulary, translated to the row model's schema
  vocabulary and merged into derivations on the way through.

Two limits on `setColumnAggregate` worth knowing before you offer it to a user.
It is **rows mode only** — in explicit-model mode the caller owns their row
model and the hook never re-requests its derivations, so the write is recorded
in engine state and changes nothing a group row shows; state the aggregate on
the model's own columns instead. And an **invalid aggregate destroys the grid**,
not just the write: it surfaces as a render-time `CompiledQueryValidationError`
inside the commit the write schedules, which unmounts the tree (or empties the
subtree, under an error boundary) with no recovery short of a remount. A UI
offering free-form aggregates must validate before calling.
