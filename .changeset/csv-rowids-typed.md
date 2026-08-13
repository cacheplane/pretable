---
"@pretable/react": minor
---

`PretableCsvOptions` is now generic in the grid's row-id type, so `rowIds` is
checked against it rather than against the `PretableRowId` union.

The union is `string | number`, so a `Set<number>` on a string-id grid used to
type-check, match nothing, and produce a header-only file — a mistyped id
silently emptying the export. `TRowId` defaults to the union, so every use that
does not touch `rowIds` is unaffected.
