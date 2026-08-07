---
"@pretable/react": patch
---

Add `onRowActivate` for "open the record this row stands for".

Activating a row and selecting cells are different intents, but the only signal
available was `onSelectedRowIdChange`, which is tied to selection: a plain click
selects a single cell, never a full row, so it never fired. Consumers had to
hand-roll an `onClick` through `getRowProps`.

`onRowActivate` fires on a plain click anywhere in a row and on Enter/Space on
the focused cell, receiving `{ row, rowId, rowIndex }`. A modifier-click, the
click that ends a drag-select, and a click inside a cell that is being edited
are all something else, and do not activate. Available on both
`<PretableSurface>` and the `<Pretable>` drop-in.
