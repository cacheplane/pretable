---
"@pretable/react": minor
---

Wire CSV export into `<PretableSurface>`.

Three props mirroring the clipboard trio — `csvOptions`, `onExport` (return
`null` to cancel) and `saveFile` — plus `exportCsv(options?)` on the grid handle
`onGridReady` hands you, since this grid has no toolbar and the trigger belongs
to the consumer's own button.

`exportCsv` resolves columns from the DRAWN order, passes the scope
`resolveDataScope` computed, and announces through the live region — including
when the file is partial, which the announcement says out loud rather than
leaving to `omissions`.

`onlySelected` and `rowIds` are refused together. They are two ways to name the
same row set, and merging one over the other made the caller's explicit set
vanish with nothing said.
