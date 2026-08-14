---
"@pretable/core": minor
"@pretable/react": minor
---

Make the row-checkbox slice controllable: `state.rowSelection`,
`grid.setRowSelection()`, and a `PretableRowSelectionState` shape that stays
sparse.

Every UI slice could be driven from outside except this one. `query`,
`selection`, `focus` and the column layout all had a controlled prop; the
checked set could only be READ, through `onRowSelectionChange` and the grid
handle. So there was no restoring a saved selection, no "tick everything
matching this filter", and no undo — and the docs said as much: "There is no
`state.rowSelection` counterpart in v1."

`setSelection` looks like it should already do the job and cannot. It takes the
engine's own containers — a `ReadonlySet` and an opaque normalized interval
index — which a consumer has no way to construct, and the surface's controlled
write-back deliberately carried the engine's `rows` through untouched.

The new public shape is the engine's union with the containers a consumer can
actually write:

```ts
type PretableRowSelectionState<TRowId> =
  | {
      kind: "explicit";
      rowIds: readonly TRowId[];
      ranges?: readonly PretableIndexedRowRange<TRowId>[];
      excludedRowIds?: readonly TRowId[];
    }
  | { kind: "all"; excludedRowIds?: readonly TRowId[] };
```

Sparseness is the whole point of not flattening this to a list of ids.
`{ kind: "all" }` is symbolic: applying it visits none of the population, so
select-all over half a million rows is the same work as over five.
`ranges` carries a shift-checked span as its two endpoints. `excludedRowIds` is
points rather than spans, because points are what the engine can store — a
span-shaped exclusion would read as though it could untick a range.
`describeRowSelection()` converts the engine's value back to this shape, so a
symbolic selection can be saved and restored without ever being resolved.

Two behaviours worth reading before using it:

- The slice is applied when its VALUE changes, not on every render.
  `onRowSelectionChange` fires from an effect rather than from the click, so for
  one commit the controlled value is a generation behind the grid; re-asserting
  it there would untick the row the user just ticked, and the callback would
  then report the untick instead of the tick.
- It is resolved against the rows the grid currently shows — ids it cannot see
  are dropped, exactly as ticking them by hand would be — and re-applied when
  the row model publishes, so a streaming grid ends up with what was asked for
  rather than with what it meant at mount.

Also fixes a pre-existing report: ticking a row and then clicking the header
select-all fired `onRowSelectionChange([])`, because a symbolic selection
materializes as an empty list. The header checkbox was already documented as
silent; it is now silent for the whole time the selection stays symbolic, and
reports again as soon as it becomes an explicit list.
