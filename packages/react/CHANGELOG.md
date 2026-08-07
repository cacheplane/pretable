# @pretable/react

## 0.0.3

### Patch Changes

- Add `onRowActivate` for "open the record this row stands for". ([#211](https://github.com/cacheplane/pretable/pull/211))

  Activating a row and selecting cells are different intents, but the only signal
  available was `onSelectedRowIdChange`, which is tied to selection: a plain click
  selects a single cell, never a full row, so it never fired. Consumers had to
  hand-roll an `onClick` through `getRowProps`.

  `onRowActivate` fires on a plain click anywhere in a row and on Enter/Space on
  the focused cell, receiving `{ row, rowId, rowIndex }`. A modifier-click, the
  click that ends a drag-select, and a click inside a cell that is being edited
  are all something else, and do not activate. Available on both
  `<PretableSurface>` and the `<Pretable>` drop-in.

- Keep grid state alive when the `columns` prop gets a new identity. ([#211](https://github.com/cacheplane/pretable/pull/211))

  Row data is already reconciled in place via `grid.setRows`, but `columns` was
  not: a new array identity recreated the grid, taking every slice it owns with it
  — sort, filters, selection, focus, column widths and order, and an in-flight
  cell edit. An inline `columns={[...]}` is a new identity on every render, so
  "keep `columns` a stable reference" was load-bearing rather than an
  optimisation; forget it and clicking a header to sort silently stops working.

  `columns` now merges into the live grid the same way rows do. Two supporting
  changes make that safe:
  - The merge runs on every identity change rather than only when the set of
    column ids changes, so a changed header, width, or accessor is picked up.
  - `mergeColumnsFromProps` only notifies subscribers when something observable
    actually moved, so re-creating the array without changing anything is a no-op
    instead of a render loop. Column definitions are stored either way, which is
    what keeps a re-created `value`/`format` closure from going stale.

- Fix autosize after an empty first render, header layout, and cell clipping. ([#211](https://github.com/cacheplane/pretable/pull/211))
  - `setRows` now re-runs autosize against the incoming rows. Fetch-then-render is
    the usual order, so the first pass sees no rows and autosize can only fall
    back to its minimum width — which it then kept for the rest of the grid's
    life. Measured from the original column definitions, since autosize skips any
    column that already carries a width; widths the consumer set are left alone.
  - The header cell's inline style was `display: grid` with `align-items: start`.
    Inline styles beat the skin no matter how it is layered, so this quietly
    overrode `[data-pretable-header-cell]`'s `display: flex; align-items: center`
    in `@pretable/ui`, and stacked any multi-node `renderHeaderCell` into rows
    that overflow the header strip. Now flex/center, matching the skin.
  - The default header rendered the words "Newest", "Oldest", and "Sort" — date
    vocabulary applied to every column, which reads wrong on a name or a number.
    Sorted columns now show a direction glyph (`▲`/`▼`) carrying
    `data-pretable-sort-indicator` for themes to target; unsorted columns show
    none, with `aria-sort` and the button's `aria-label` carrying the state.
    **Consumers asserting on that text will need to update**; `renderHeaderCell`
    still overrides the default entirely.
  - Body cells now set `overflow: hidden`. Cells are absolutely positioned, so a
    value wider than its column used to paint straight over its neighbour. Note
    that a cell is a flex container, where `text-overflow: ellipsis` has no
    effect — for an ellipsis, render the value inside a shrinkable element
    (`min-width: 0`) via the column's `render`.

- Updated dependencies [[`7765a95`](https://github.com/cacheplane/pretable/commit/7765a95f5d7d207c6b962e29b0766f117c39570e)]:
  - @pretable/core@0.0.3
  - @pretable/ui@0.0.3

## 0.0.2

### Patch Changes

- Add MIT license metadata, repository links, homepage links, and issue tracker ([#104](https://github.com/cacheplane/pretable/pull/104))
  metadata to the public packages as part of the open-source community health
  pass.
- Updated dependencies [[`a63886d`](https://github.com/cacheplane/pretable/commit/a63886d2131150f810c5210e0e1861f3ac6f8d09)]:
  - @pretable/core@0.0.2
  - @pretable/ui@0.0.2

## 0.0.1

### Patch Changes

- Internal `react-surface` workspace package collapsed into `@pretable/react`. ([#66](https://github.com/cacheplane/pretable/pull/66))
  All grid components are now exported directly from the public package:
  - `<PretableSurface>` — the kitchen-sink grid component
  - `<InspectionGrid>` — preset for inspection-style data
  - `<LabeledGridSurface>` — preset with labeled cells

  The opinionated `<Pretable>` preset stays. The `interactionState` prop on
  `<PretableSurface>` is marked `@experimental` — bench-internal feature
  exposed for advanced consumers, shape may change.

- Initial release. Pretable's wrapped-text scroll wedge (4× faster than Grid Alpha on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs Grid Alpha's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives. ([#58](https://github.com/cacheplane/pretable/pull/58))

  See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.

- Updated dependencies [[`c1fb1d3`](https://github.com/cacheplane/pretable/commit/c1fb1d3266dad24153de60b92931147f14667d5a)]:
  - @pretable/core@0.0.1
