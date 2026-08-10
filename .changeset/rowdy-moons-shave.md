---
"@pretable/core": minor
"@pretable/react": minor
---

**Breaking:** `getRowId` is now required on every entry point, and its `index`
parameter is gone. Row identity is never positional.

`createGrid`, `usePretable`, `<Pretable>`, `<PretableSurface>` and
`<LabeledGridSurface>` previously disagreed: `<Pretable>` guessed `row.id` and
then fell back to the array index, the rest fell through to the engine's
positional default. Selection, focus, in-flight edits, group expansion and
`applyTransaction` are all keyed by row id and are designed to survive a
wholesale row replacement — under a positional id that design silently
re-pointed them at whichever rows had moved into those positions. No error, no
warning, wrong rows.

`getRowId` now takes only the row, so position is not in scope:

```diff
- getRowId?: (row: TRow, index: number) => string;
+ getRowId: (row: TRow) => string;
```

Migration: pass `getRowId` wherever you construct a grid. Rows with no natural
key need one synthesized when the data is loaded — an index captured at load
time is stable; an index read at lookup time is not.

`createGrid` throws when `getRowId` is missing or is not a function, for
callers TypeScript cannot reach. `applyTransaction`'s narrower version of that
check is gone: it is now unreachable, and it was already unreachable from React,
where `usePretable`'s stable wrapper walked an omitted `getRowId` straight past
it.
