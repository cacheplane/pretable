# @pretable/react

## 0.6.0

### Minor Changes

- Group expansion now defaults to expanded rather than collapsed. ([#350](https://github.com/cacheplane/pretable/pull/350))

  `createLocalRowModel` and `PretableSurface` open groups by default, restoring the behaviour `grid-core` shipped before the incremental row-model migration. Grouping is an interactive act here — a user drags a column into the group panel while reading their rows — and collapsing on drop hid the data they were just looking at.

  Pass `initialExpansion` to choose another policy. `{ kind: "through-depth", depth: 0 }` opens only the top level and is the one to reach for when the grouped population is too large to draw at once.

### Patch Changes

- Updated dependencies [[`65d0365`](https://github.com/cacheplane/pretable/commit/65d0365fdc755903dccbdccc9844cbf4d2eab2d8)]:
  - @pretable/core@0.6.0
  - @pretable/ui@0.6.0

## 0.5.2

### Patch Changes

- Stop re-estimating the height of a row that has already been measured. ([#342](https://github.com/cacheplane/pretable/pull/342))

  When a streaming update replaced a row's data, the row layout controller published a fresh
  `estimateDomRowHeight` value for it — even though the DOM had already reported that row's real
  height. The estimate and the measurement disagree for any wrapped column, so every update swapped
  one for the other and the rows below it jumped. On the homepage hero grid, which streams cell
  updates into a wrapped column, this read as continuous jitter.

  The controller now retains the last measured height per data-row identity and uses it as the
  estimate gate's fallback, so an estimate is only ever used for a row that has never been measured.
  Measured in Chrome against the hero grid, estimator-valued publications over a streaming run
  dropped from 71 to 0.

  Retention is bounded by a new `maxRetainedRowHeights` option and is scoped to data rows; group
  entries are never retained, since the estimate gate that consumes retained heights is itself gated
  on data rows.

- Updated dependencies []:
  - @pretable/core@0.5.2
  - @pretable/ui@0.5.2

## 0.5.1

### Patch Changes

- Fix a WebKit-only stall that left large grids blank for hundreds of milliseconds after mount. ([#343](https://github.com/cacheplane/pretable/pull/343))

  The row-layout controller yields between build slices, and its fallback scheduled each continuation with `setTimeout(task, 0)`. Because every slice schedules the next from inside the previous one, those are nested zero-delay timers, which browsers clamp to ~4ms — pure latency, paid per slice, while the grid shows nothing. Safari ships no `scheduler.postTask`, so it always took that path.

  Measured on a 2,500 × 500 grid, mount to first painted cell: WebKit 263ms across 25 timer hops, against 13ms in Chromium; removing `postTask` from Chromium reproduced the stall exactly (176–190ms), so the engine was never the variable. The fallback now prefers an unclamped `MessageChannel` message, the same ladder the row model's cooperative transition already used, and WebKit lands at ~15ms.

- Updated dependencies []:
  - @pretable/core@0.5.1
  - @pretable/ui@0.5.1

## 0.5.0

### Minor Changes

- Release the work merged since 0.4.0. Ten commits landed on `main` without changesets and so were never published; this releases them together. ([#330](https://github.com/cacheplane/pretable/pull/330))

  **Row model (#321)** — the incremental row-model migration completes, changing public surface in `@pretable/core` (grid construction, the local row model, and the exported types).

  **Cell presentations (#318, #319)** — the semantic ramp and the first cell presentations, then badge and entity presentations, added to `@pretable/react`'s public API.

  **Theming (#322)** — `pretable.css` is the house theme and the documented default; Excel and Material become compatibility skins.

  **Fixes (#324, #325)** — a focused cell now draws exactly one ring rather than two, which also restores the pinned-column seam the duplicate ring had been evicting from its `box-shadow` slot; the Material dark checkmark moves from 1.70:1 to 7.73:1 contrast; and the row-height floor follows `--pretable-row-height` instead of a hard-coded 44px, so a themed density change is honored by measured and estimated rows alike.

### Patch Changes

- Fix the cell focus ring, which was declared but never painted. Every gridcell rendered with an inline `outline: none` — added years earlier alongside keyboard navigation, when the ring was drawn as an inset `box-shadow` and the user-agent outline needed suppressing. Once the ring became an `outline`, that inline declaration silently erased it: an inline style beats a `@layer` + `:where()` rule at any specificity. `outline-offset` kept applying, so the rule still looked live while nothing was drawn, and a focused cell showed no focus indicator in any consuming app. ([#333](https://github.com/cacheplane/pretable/pull/333))

- Updated dependencies [[`a7ce60a`](https://github.com/cacheplane/pretable/commit/a7ce60a7d90f4107f7e2af91326dceea5b1e023c)]:
  - @pretable/core@0.5.0
  - @pretable/ui@0.5.0

## 0.4.0

### Minor Changes

- Add opt-in native number formatting with locale-aware money and accounting presets, aggregate inheritance, and matching clipboard output. ([#317](https://github.com/cacheplane/pretable/pull/317))

- **Breaking:** remove `<InspectionGrid>` and its types (`InspectionGridProps`, `InspectionRow`, `InspectionSeverity`, `InspectionFilterableColumnId`) from `@pretable/react`. ([#303](https://github.com/cacheplane/pretable/pull/303))

  It could not be used. The component hardcoded `columns` to `inspectionColumns` from `@pretable-internal/scenario-data` — a private test-fixture package — so it rendered a fixed seven-field log schema (`timestamp`, `severity`, `source`, `owner`, `tags`, `message`) no matter what you passed to `rows`. There was no prop to change that. Because `tsup` marks `@pretable-internal/*` as `noExternal`, the fixture's column array was bundled into the published tarball.

  Nothing it added was reachable by a consumer. Against `<LabeledGridSurface>`, which it wrapped, it contributed: the fixture columns; a `formatValue` whose body was identical to `<LabeledGridSurface>`'s own default; `getRowId: (row) => row.id`, a positional-identity guess this repo refuses at every other entry point; `selectFocusedRowOnArrowKey`; six hardcoded class names whose only stylesheet lived in the pretable website's `globals.css`, scoped to an `#grid` id no page has had since the playground was removed; and a `data-filterable="true"` attribute nothing in the repo reads.

  **Migration.** Use `<LabeledGridSurface>` and pass your own columns — it takes every prop `<InspectionGrid>` forwarded, plus the ones `<InspectionGrid>` fixed:

  ```tsx
  <LabeledGridSurface<MyRow>
    ariaLabel="Events"
    columns={columns}
    getRowId={(row) => row.id}
    rows={rows}
    selectFocusedRowOnArrowKey
    viewportHeight={460}
    bodyCellClassName="my-cell"
    labelClassName="my-cell-label"
    valueClassName="my-cell-value"
  />
  ```

  `<LabeledGridSurface>` already joins array values with `", "` and stringifies the rest, so the removed `formatValue` needs no replacement.

  `@pretable/react` no longer depends on `@pretable-internal/scenario-data` in any form.

### Patch Changes

- Estimate wrapped row heights at a `flex` column's resolved width. ([#304](https://github.com/cacheplane/pretable/pull/304))

  A wrapped column's height estimate wrapped its text at `widthPx`, or at a fixed fallback when the
  column declared none. That is not the width a `flex` column is drawn at — the drawn width comes from
  distributing the leftover viewport space, and it moves with the viewport, with a sibling column's
  resize, and with a column leaving the drawn set while grouped. So a column declaring both `wrap` and
  `flex` had an estimate that never moved at all.

  Measured in a browser with one `flex: 1` wrapped column beside a 140px fixed one, the estimate held
  at 138px across drawn widths of 1058px, 558px and 318px — text that really occupied one, two and
  three lines. It now tracks the drawn width, so rows that have not been measured yet are placed at a
  height the viewport agrees with. The visible symptoms were scroll-anchor drift and a scrollbar sized
  for content that was not there.

  Only grids with a column declaring both `wrap` and `flex` are affected; every other column resolves
  its width exactly as before.

- Resolve `flex` columns at their drawn width when hit-testing a header drag and when scrolling a column into view. ([#312](https://github.com/cacheplane/pretable/pull/312))

  `planColumnLayout` — the one plan shared by drag-to-reorder hit-testing and keyboard scroll-into-view — resolved every column through the renderer's `widthPx`-or-fallback rule. A `flex` column is not drawn at that width: it is drawn at its share of whatever the fixed columns leave over. Both consumers compare this plan against rendered pixels, so a flex column put every column after it at an offset nothing on screen had.

  Measured in a browser with one `flex: 1` column between fixed ones in a 1000px scrollport, where the flex column is painted 518px wide:

  - dragging a header and parking the cursor inside the next column painted the drop indicator 98px away from the boundary the cursor was over, and the drop landed the column at the far end of the grid instead of where the cursor pointed;
  - with the flex column clamped by `minWidthPx` so the row overflowed, arrowing right to the last column did not scroll at all — the flex-blind plan's `totalWidth` was narrower than the viewport, so the reveal clamped its offset to 0 and the focused cell stayed off screen.

  Both now match the painted geometry. Only grids with a `flex` column are affected; every other column resolves exactly as before, as does any grid whose scrollport has not been measured yet.

- Updated dependencies [[`dccf75e`](https://github.com/cacheplane/pretable/commit/dccf75e4d9cdee0b0b8dd040ba921981c85255d7), [`d257a8f`](https://github.com/cacheplane/pretable/commit/d257a8ffde065aabb4c0e1582f23598a37b734ac)]:
  - @pretable/core@0.4.0
  - @pretable/ui@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`afdaf45`](https://github.com/cacheplane/pretable/commit/afdaf451d09bb5fd841a70efc15f41b34cf1880b)]:
  - @pretable/ui@0.3.2
  - @pretable/core@0.3.2

## 0.3.1

### Patch Changes

- Replace the grid's glyphs with a first-party stroked icon set. ([#295](https://github.com/cacheplane/pretable/pull/295))

  There was no icon set — there were nine glyph sources across three incompatible rendering systems.
  Two _filled_ SVGs (the filter funnel and the column-menu overflow) authored on a 16 grid but drawn
  at 11px, so every edge landed on a fractional pixel. Six Unicode text characters — the sort arrows,
  the group twisty, the row-select tick, the indeterminate dash, the chip's close — which re-rendered
  in whatever font the active theme picked, so their weight, size and baseline shifted between Excel's
  Aptos Narrow and Material's Roboto and again across platforms. And a CSS `radial-gradient` for the
  chip's grip dots. Nothing could give them a shared stroke weight or optical size.

  They are now nine glyphs on one 16px grid: 1.5px stroke, rounded caps and joins, drawn in
  `currentColor` and sized from a new `--pretable-icon-size` token — 12px under Excel, 16px under
  Material. No icon-library dependency, and nothing added to the public API.

  The one exception is the number editor's stepper arrows, which stay as text. Converting them was
  tried and measured: the editor's height moved 3px, its stepper column widened 3.6px, and the stacked
  buttons overflowed their container by 9px. No smaller size rescues it either — holding that column's
  width needs roughly a 6.4px glyph, whose stroke scales below 1px. The column is dimensioned around
  an 8px text glyph and needs redesigning before an icon fits.

  If you set `--pretable-icon-size` in a custom theme you control every glyph at once. If you do not,
  they fall back to 16px — an SVG with a `viewBox` and no width has no useful intrinsic size, so the
  fallback is load-bearing rather than decorative.

- Updated dependencies [[`6c2d05c`](https://github.com/cacheplane/pretable/commit/6c2d05cfa09032dd4fdfba7ca28d054dcd47df72)]:
  - @pretable/ui@0.3.1
  - @pretable/core@0.3.1

## 0.3.0

### Minor Changes

- **Breaking:** `getRowId` is now required on every entry point, and its `index` ([#293](https://github.com/cacheplane/pretable/pull/293))
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

### Patch Changes

- Updated dependencies [[`af880e8`](https://github.com/cacheplane/pretable/commit/af880e8996abc55e70b179d5b3e3eb033ab2aad8)]:
  - @pretable/core@0.3.0
  - @pretable/ui@0.3.0

## 0.2.0

### Minor Changes

- Every type `@pretable/react` names in a public signature is now importable from ([#290](https://github.com/cacheplane/pretable/pull/290))
  `@pretable/react`.

  API Extractor had been reporting 23 `ae-forgotten-export` warnings against
  `react.api.md` — types a public signature declares that the entry point does not
  export. They were warnings, so they were generated, committed, and reviewed past.
  `PretableSelectionState`, for one, is the parameter type of `onSelectionChange`
  and of `PretableGrid.setSelection`; a consumer writing either handler could not
  name its parameter without reaching into `@pretable/core`, which no doc page
  tells them to do. The count is now zero, in all four published packages.

  Newly exported:

  - Engine types already public in `@pretable/core`: `AutosizeOptions`,
    `PretableAggregateFormatInput`, `PretableCellAddress`, `PretableCellRange`,
    `PretableFocusState`, `PretableMoveFocusOptions`, `PretableRowRange`,
    `PretableSelectionState`, `PretableSortDirection`, `PretableTransaction`,
    `PretableViewportState`, and the engine's column as `PretableBaseColumn` (this
    package's `PretableColumn` extends it, so it sits in a public `extends`
    clause).
  - Render-snapshot geometry: `PlannedColumn` and `RowMetricsReader`, both members
    of `PretableRenderSnapshot`, which `usePretable` returns.
  - `InspectionGrid`'s row contract — `InspectionRow`, `InspectionSeverity`,
    `InspectionFilterableColumnId` — now declared by this package instead of
    imported from an internal fixture package.
  - Surface hook inputs: `PretableSurfaceRowInput`,
    `PretableSurfaceHeaderCellInput`, `PretableSurfaceHeaderCellRenderInput`.

  Renamed, and collapsed where two names meant one shape:

  - `renderBodyCell`, `getBodyCellClassName` and `getBodyCellProps` now declare
    `PretableCellRenderInput`, which was always what their three separate alias
    names resolved to and was already exported.
  - `getRowClassName` / `getRowProps` take `PretableSurfaceRowInput` (was
    `PretableSurfaceRowClassNameInput` / `PretableSurfaceRowAttributesInput`, two
    identical interfaces).
  - `getHeaderCellClassName` / `getHeaderCellProps` take
    `PretableSurfaceHeaderCellInput` (was `PretableSurfaceHeaderClassNameInput` /
    `PretableSurfaceHeaderAttributesInput`).

  None of those old names were exported, so no consumer could have been importing
  them; the shapes the callbacks receive are unchanged.

### Patch Changes

- Updated dependencies []:
  - @pretable/core@0.2.0
  - @pretable/ui@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`917fe91`](https://github.com/cacheplane/pretable/commit/917fe916e91edcd2e15ff7444fd25db6e0b100e3)]:
  - @pretable/ui@0.1.1
  - @pretable/core@0.1.1

## 0.1.0

### Minor Changes

- Add server-authority primitives (experimental). ([#286](https://github.com/cacheplane/pretable/pull/286))

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

  **Also breaking:** four of the new members are required, not optional, so any
  hand-built object of these types stops compiling until it supplies them —
  `matchingTotal` and `datasetKey` on `PretableGridSnapshot`, `matchingTotal` on
  `PretableTelemetry`, and `scope` on `PretableAggregateFormatInput`. Code that
  only reads these types is unaffected.

### Patch Changes

- Updated dependencies [[`f691e9c`](https://github.com/cacheplane/pretable/commit/f691e9cff7d44c23d3df2439e75ab6fc4950cd2c)]:
  - @pretable/core@0.1.0
  - @pretable/ui@0.1.0

## 0.0.14

### Patch Changes

- Document both required React 19 peer dependencies in the package README. ([#271](https://github.com/cacheplane/pretable/pull/271))

- Updated dependencies []:
  - @pretable/core@0.0.14
  - @pretable/ui@0.0.14

## 0.0.13

### Patch Changes

- Split the grid's line vocabulary and give numeric columns real alignment. ([#269](https://github.com/cacheplane/pretable/pull/269))

  `--pretable-rule` previously coloured both the horizontal row hairline and the
  vertical column divider, so no theme could drop the vertical gridlines without
  also losing row separation. Two new tokens, `--pretable-rule-vertical` and
  `--pretable-rule-width`, split the axes. Both shipped themes alias the vertical
  token back to `--pretable-rule`, so Excel and Material render unchanged.

  Columns now carry an optional `align` (`"start" | "center" | "end"`), and the
  surface emits `data-pretable-column-type` and `data-pretable-column-align`.
  Number columns default to trailing alignment with tabular, lining figures — in
  the grid's own font, not a monospace substitute. Alignment uses
  `justify-content: safe flex-end`; the `safe` keyword matters, because a plain
  trailing alignment clips an over-wide value at its leading edge, which would
  render `1,234,567` as a legible and completely wrong `34,567`.

  Fixes a bug where header cells, which render as `<button>`, never reset the
  user-agent button background — so the grid only looked correct in apps that
  happen to ship a CSS reset.

  Removes three declarations that never painted: the `[data-pretable-numeric]`
  rule, which nothing has ever emitted despite `@pretable/ui`'s README advertising
  it as part of the public attribute contract; the `[data-pretable-toolbar]` and
  `[data-pretable-status-bar]` rules, which no component can emit; and the
  selection rule's `background`, which could never win against the `aria-selected`
  rule that follows it at equal specificity. The selection rule keeps its `color`,
  which is load-bearing.

- Updated dependencies [[`943b21a`](https://github.com/cacheplane/pretable/commit/943b21a63cb2e62d2eb842f47a5c4e4e084e4c91)]:
  - @pretable/core@0.0.13
  - @pretable/ui@0.0.13

## 0.0.12

### Patch Changes

- Group panel: chips that do not fit now scroll instead of being clipped. ([#267](https://github.com/cacheplane/pretable/pull/267))

  The strip was a nowrap flex row at a fixed height with `overflow: hidden`, so
  grouping by enough columns painted the later levels into dead space — unreachable
  by mouse, and focusable-but-invisible by keyboard. It now scrolls horizontally,
  keeping the fixed height that `PretableSurface` subtracts from `viewportHeight`.

  - `overflow-x: auto` on the panel, with `scrollbar-width: thin` so a classic
    scrollbar cannot eat a third of a compact strip.
  - A focused chip is revealed inside the strip, and only inside it: chips are
    focused with `preventScroll` so revealing one cannot scroll the surrounding
    page sideways.
  - A chip or header drag held near either edge autoscrolls the strip, so a drop
    position that is scrolled out is still reachable.

- Updated dependencies []:
  - @pretable/core@0.0.12
  - @pretable/ui@0.0.12

## 0.0.11

### Patch Changes

- Reconcile the selection when the drawn column model changes, so grouping or ([#264](https://github.com/cacheplane/pretable/pull/264))
  ungrouping no longer drops full-row selections, double-toggles a row, or copies
  a single column instead of the whole row.

- Give the header row the pixel it shares with the group panel. The panel and the ([#264](https://github.com/cacheplane/pretable/pull/264))
  scroll viewport abut exactly, so the panel's bottom edge is the header's top
  edge — and the panel's hit test claimed it. Dropping a dragged header on the
  header's first row of pixels grouped by that column instead of reordering it.
  The panel's rect is now half-open on its right and bottom edges.

- Stop invalidating the derived rows for a re-created `value` closure on a grid ([#264](https://github.com/cacheplane/pretable/pull/264))
  that is not grouped by that column. An inline `columns={[…]}` array no longer
  emits — and no longer destroys `visibleRows` identity — on every parent update.

- Reconcile the selection when a column is reordered, pinned, or the layout is ([#264](https://github.com/cacheplane/pretable/pull/264))
  reset. A range does not need to lose a column to break — it only needs the
  columns between its endpoints to change — so dragging a header used to leave a
  selected row half-checked and make Cmd+C copy the wrong columns, with no
  grouping involved at all.

- Accept `groupColumn`, `hideGroupedColumns`, `aggregateFilteredRows` and ([#264](https://github.com/cacheplane/pretable/pull/264))
  `groupsDefaultExpanded` on `usePretable` and `<PretableSurface>`, and re-export
  `PretableGroupColumnOptions`. `groupColumn={{ pinned: "left" }}` is now
  reachable from React, which is the only way to seat the tree column ahead of
  left-pinned data columns.
- Updated dependencies [[`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602), [`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602), [`6131d84`](https://github.com/cacheplane/pretable/commit/6131d8441b58560dd4c0c8e9d102c524bb25d602)]:
  - @pretable/core@0.0.11
  - @pretable/ui@0.0.11

## 0.0.10

### Patch Changes

- Prevent populated server-rendered grids from triggering React hydration recovery when CSS theme heights differ from package fallbacks. ([#261](https://github.com/cacheplane/pretable/pull/261))

- Updated dependencies []:
  - @pretable/core@0.0.10
  - @pretable/ui@0.0.10

## 0.0.9

### Patch Changes

- Fix row grouping selection, focus, clipboard output, and treegrid accessibility, ([#259](https://github.com/cacheplane/pretable/pull/259))
  including keyboard grouping controls and expansion announcements.
- Updated dependencies [[`f1b9e43`](https://github.com/cacheplane/pretable/commit/f1b9e4391daf3b57ae987fd022ea577ad81e0e3b)]:
  - @pretable/core@0.0.9
  - @pretable/ui@0.0.9

## 0.0.8

### Patch Changes

- Let header text follow `--pretable-text-header` instead of an inline ([#256](https://github.com/cacheplane/pretable/pull/256))
  `color: inherit`, which beat the skin and silently rendered header labels in the
  body-cell color. Completes the pair with the header divider fix: header text is
  now dimmer than cell text again, in both light and dark themes, and consumer
  token overrides reach it.
- Updated dependencies []:
  - @pretable/core@0.0.8
  - @pretable/ui@0.0.8

## 0.0.7

### Patch Changes

- Render grouped rows with a derived group column, aggregate formatting, and the ([#255](https://github.com/cacheplane/pretable/pull/255))
  ARIA treegrid keyboard model. Grouped grids now expose expandable hierarchy
  rows with themed indentation and keep focus anchored when groups collapse.

- Let header dividers inherit `--pretable-rule` from the grid skin instead of a ([#252](https://github.com/cacheplane/pretable/pull/252))
  fixed inline color, so they match body gridlines in light and dark themes and
  respond to consumer token overrides.
- Updated dependencies [[`99597d1`](https://github.com/cacheplane/pretable/commit/99597d13123ad2631f377855e0e046a54058cbb9), [`5ebfa8a`](https://github.com/cacheplane/pretable/commit/5ebfa8ae336b350f8a53e40845c700bb3b0a31a6)]:
  - @pretable/core@0.0.7
  - @pretable/ui@0.0.7

## 0.0.6

### Patch Changes

- Add `column.flex` — fill the container instead of guessing widths. ([#249](https://github.com/cacheplane/pretable/pull/249))

  Every column was fixed: `widthPx`, or a fallback, or a one-off measurement from
  `autosize`. Nothing sized to the container, so a grid either stopped short of
  its right edge or ran past it, and the only recourse was hand-tuning `widthPx`
  for one target width — which stops being right at any other window size.

  `flex` gives a column a share of whatever the fixed columns leave over. Weights
  are relative: two columns at `flex: 1` split the remainder evenly; `1` and `3`
  split it a quarter to three quarters. `minWidthPx`/`maxWidthPx` still apply, and
  a column carrying an explicit `widthPx` — including one a resize drag produced —
  stops flexing, since an explicit width outranks a computed one.

  Distribution is exact: the final flex column absorbs the rounding remainder, so
  the row ends on the viewport edge rather than a pixel short. Grids with no flex
  column render byte-for-byte as before, as does any grid whose viewport has not
  been measured yet (SSR, and the first paint before the scrollport is read).

- Updated dependencies [[`c2581fb`](https://github.com/cacheplane/pretable/commit/c2581fb5f630740aedc890670fedc532647cf21e)]:
  - @pretable/core@0.0.6

## 0.0.5

### Patch Changes

- Add `onRowSelectionChange` — the checked rows, for bulk actions. ([#230](https://github.com/cacheplane/pretable/pull/230))

  `rowSelectionColumn` draws the checkboxes, but there was no way to read what
  they had checked. `onSelectedRowIdChange` reports a single row, and
  `onSelectionChange` reports raw cell ranges — spans of `(startRowId, endRowId)`
  that a consumer cannot expand, because they only mean something against the
  rendered row order, which the grid owns once sorting is applied. So the one
  thing checkboxes are for — "do this to the rows I ticked" — was unreachable.

  `onRowSelectionChange` fires with those row ids in rendered order whenever the
  set changes, and stays quiet when it doesn't (selection is recomputed on every
  render, including every poll that hands down new rows). Available on both
  `<PretableSurface>` and the `<Pretable>` drop-in. The grid already tracked this
  set internally to draw the checkboxes; this exposes it.

- Updated dependencies []:
  - @pretable/core@0.0.5

## 0.0.4

### Patch Changes

- Column array order is now visual order, and reordering pins symmetrically. ([#220](https://github.com/cacheplane/pretable/pull/220))

  `planColumns` renders columns in three regions — left-pinned, scrollable,
  right-pinned — so a column's index in the engine array is the position it
  actually renders at only while that array is already grouped that way. Three
  consumers depended on this silently: `aria-colindex`, the reorder gesture's drop
  hit test, and the column-offset map it scans. `setColumnPinned` maintained the
  grouping. `moveColumn` and every path that accepted columns from outside did not.

  Two symptoms, one cause. A right-pinned column dragged to array index 0 kept its
  pin — reordering deliberately does not silently unpin — but then sat at index 0
  while rendering last, so assistive technology announced "column 1" for a column
  drawn at the far right. And an unpinned column dropped past the right-pinned
  group landed after it with no auto-pin, while the left region had an
  auto-pin/unpin rule.

  **`moveColumn` now derives the moved column's pin from the region it lands in.**
  The leading pinned region gives it `"left"`, the trailing region gives it
  `"right"`, and anywhere between the two leaves it unpinned. Left-region behavior
  is unchanged — same boundary computation, same predicate, same result — and the
  right is now its exact mirror.

  **Behavior change: a right pin can now be lost to a drag**, exactly the way a
  left pin already could. Dragging a right-pinned column out of the trailing group
  unpins it; dragging any column into that group pins it there. If you relied on a
  right pin surviving every reorder, set `reorderable: false` on that column. When
  pin state changes alongside a reorder, `onColumnPinnedChange` fires alongside
  `onColumnOrderChange` in the same commit, as before.

  Because the drop index is adjusted for the fact that `moveColumn` removes a
  column before re-inserting it, each pinned column is a two-halves target: its
  leading half drops ahead of the group and stays scrollable, its trailing half
  drops inside it and takes the pin.

  **Columns are regrouped on the way in, not just on mutation.** A `columns` array
  that interleaves pinned and unpinned entries is now normalized at mount, on every
  prop update, and on `resetColumnLayout`, with relative order preserved inside each
  region. The sharp edge was the prop path: `mergeColumnsFromProps` rebuilds in the
  consumer's declared order while merging _runtime_ pin state back in, so any prop
  update after a user pinned something re-broke the grouping — and with it
  `aria-colindex` — until the next reorder. Declaring
  `[symbol, note (right), name]` is fine; it becomes `[symbol, name, note]`.

  The synthetic row-select column leads its own region rather than the whole array.
  It is pinned left by default, where those are the same thing, but
  `rowSelectionColumn.pinned: false` makes it scrollable, and seating it at index 0
  ahead of the left-pinned run would be the very desync this prevents.

  **New: `grid.setColumnOrder(ids)`** reconciles a whole relative order in one
  commit. Ids matching no column are ignored, columns the caller omitted keep their
  current relative order at the end, the synthetic row-select column stays at
  position 0, and no column's pin changes.

  **Behavior change: controlled `columnOrder` is a relative order, not a literal
  layout.** It is regrouped by each column's current pin state before being
  applied, so an order that interleaves pinned and unpinned ids is normalized rather
  than honored position-for-position; `columnPinned` and the column config own pin
  state. This also fixes a hang: the reapply previously replayed the order as one
  `moveColumn` per column, and against a `columnOrder` that disagreed with
  `columnPinned` the two passes could not settle — the order pass unpinned, the pin
  pass re-pinned and repositioned, the snapshot changed, and the effect ran again.
  `setColumnOrder` never touches pin state, so they now converge.

  `aria-colindex` itself is unchanged. It is correct once the invariant holds,
  which keeps one source of truth for a column's position.

- Updated dependencies [[`9138176`](https://github.com/cacheplane/pretable/commit/9138176fb8c6906ba8ca884445285ba9141fb4da)]:
  - @pretable/core@0.0.4

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
