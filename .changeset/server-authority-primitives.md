---
"@pretable/core": minor
"@pretable/react": minor
"@pretable/ui": minor
---

Add server-authority primitives (experimental).

An upstream processor — a server, a worker, a wasm index — can now own
filtering and sorting while Pretable renders honest counts and an honest data
lifecycle.

- `processing: { filter, sort }` on `createGrid` / `PretableSurface` selects
  per-operation processing authority. `"external"` displays the state (funnel
  indicators, header arrows, `snapshot.filters`, `snapshot.sort`) without
  applying it to the loaded records.
- `setRows(rows, meta)` and `setResultMeta(meta)` accept a `PretableResultMeta`
  of `{ total, datasetKey }`. `snapshot.matchingTotal` reports the matching
  population; a changed `datasetKey` clears selection, focus, group expansion
  and any in-flight edit.
- `dataState` (no default) turns on lifecycle presentation: loading / empty /
  error body blocks, a `data-pretable-data-phase` styling hook, and result and
  error announcements. `renderBodyState` overrides the built-in blocks.
- `aria-rowcount` publishes the exact population under full external authority
  with an exact total and no grouping, and downgrades honestly otherwise.
  `aria-busy` is never set on the grid.
- Select-all, copy, group child counts and `formatAggregate` are scoped
  `"all" | "loaded"` so a partial window can never be described as everything.
- `column.filterOperators` prunes the funnel menu to operators the processor
  can honor.

**Breaking:** `PretableGridSnapshot.totalRowCount` and
`PretableTelemetry.totalRowCount` are renamed to `loadedRowCount`. There is no
alias — the old name became wrong the moment two totals existed.
