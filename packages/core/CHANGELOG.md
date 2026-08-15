# @pretable/core

## 0.9.0

### Minor Changes

- Eviction: a cell selection survives its rows being released. Under a ([#412](https://github.com/cacheplane/pretable/pull/412))
  server-controlled window, an absent row _outside_ the loaded span is now
  evicted rather than deleted — it keeps its selection, its height and its
  scroll position, and comes back selected when the window returns.

  This is the combination AG Grid's docs forbid. `maxBlocksInCache` cannot be
  combined with dynamic row heights there, and MUI documents no eviction at all.
  It works here because `resultMeta.window` already tells the engine the loaded
  span, so absence is not ambiguous: outside the window it is eviction, inside it
  is deletion, and deletion prunes exactly as before.

  **What a selection is, when its rows are gone.** A range named by two row IDs
  stops meaning anything once those rows are unloaded — an ID cannot be resolved
  to a position without the row. So a range now also carries `datasetRowSpan`,
  the absolute dataset positions of its endpoints:

  ```ts
  interface PretableIndexedDatasetRowSpan {
    readonly start: number;
    readonly end: number;
    readonly datasetKey?: string;
  }
  ```

  Count becomes `Σ(end − start + 1)` over spans — 4,901 rows reported off 30
  loaded, O(ranges) rather than O(selected rows) — and membership becomes
  containment on a rendered row's dataset position. Neither loads a row. It also
  fixes a retained range painting _nothing_, including for the loaded rows in the
  middle of its own span.

  **The number comes with a qualifier.** `grid.getCellSelectionSummary()` returns
  `{ rowCount, verified }`. A row deleted server-side while it was evicted cannot
  be detected — the engine would need a positional delete or a dataset version it
  does not have — so such a span keeps its count and drops `verified` to `false`.
  Reporting only the loaded rows would understate a genuine 4,901-row selection
  by 99%; reporting the span silently as fact would let a deleted row inflate the
  total forever. Keep the number, refuse the claim. Same shape as
  `PretableMatchingTotal`'s `"exact" | "estimate"`: the qualifier rides with the
  number, and the boundary that must speak a bare integer is the one that
  downgrades.

  **Breaking: a span is now part of a range's identity.** Two ranges over the same
  row IDs with different spans select different numbers of rows, so `sameSelection`
  no longer calls them equal. An evicted endpoint no longer collapses its range to
  the survivor either — that was the ordinary scrolling case, and it silently
  turned an 81-row selection into 1 while reporting `verified: true`. Collapse now
  requires proof of deletion. If you round-trip `state.selection` through your own
  storage, carry `datasetRowSpan` with it; the flat `PretableCellRange` gained the
  field for exactly that.

  **Breaking: `datasetKey` fails closed.** A windowed grid that publishes
  `resultMeta.window` but no `resultMeta.datasetKey` now records and reads back no
  spans at all, and selections degrade to the loaded window as they did before this
  release. That was the previously-default configuration and it was unsafe: with no
  key the engine cannot tell a scroll from a re-sort, and a re-sort refills the same
  dataset positions with different rows. Containment answers a bare boolean with no
  `verified` channel to downgrade through, so a stale span there is not a shaky
  number — it paints the wrong rows.

  **So: publish a `datasetKey` that changes whenever the query or sort order does.**
  Without one you are silently opted out of everything above, which is why
  `@pretable/react` warns once in development rather than degrading quietly.

  Local mode is untouched, byte-for-byte. With no window there are no dataset
  positions to record, so nothing is stamped and nothing is read back.

  Two things this deliberately does **not** do. It ships no evictor — it makes
  releasing rows _safe_, and a consumer shrinking its window is the trigger, which
  the windowed-data contract already allows. And select-all still means the loaded
  window: a cell range is identified by two endpoint row IDs and the engine cannot
  name a row it has never loaded. "All rows" is already expressible in the separate
  sparse row-selection program the checkbox column drives.

## 0.8.0

### Minor Changes

- Make the row-checkbox slice controllable: `state.rowSelection`, ([#409](https://github.com/cacheplane/pretable/pull/409))
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

## 0.7.0

### Minor Changes

- Windowed data: `resultMeta.window` positions a contiguous run of rows inside a larger population, and the grid keeps the scroll extent and `aria-rowindex` honest about where that window sits. Regions outside the window are pure geometry — no placeholder or skeleton rows are created, so nothing occupies an `aria-rowindex` belonging to a real record. ([#375](https://github.com/cacheplane/pretable/pull/375))

  `PretableSurface` additionally receives a `windowGap` telemetry signal when the viewport passes an edge of the supplied window, so a consumer can fetch the next block without deriving "am I near the end" from a row range and a threshold.

  The window's effects are gated on honesty: a row reports a dataset position, and the extent spans the dataset, only when the grid is also reporting the dataset count. Grouping, engine-applied filtering or sorting, and inexact totals all disable them together, so position, extent and count can never contradict each other.

  This is the addressing layer. Eviction — releasing rows to bound memory while variable row heights stay stable — builds on it.

## 0.6.2

## 0.6.1

## 0.6.0

### Minor Changes

- Group expansion now defaults to expanded rather than collapsed. ([#350](https://github.com/cacheplane/pretable/pull/350))

  `createLocalRowModel` and `PretableSurface` open groups by default, restoring the behaviour `grid-core` shipped before the incremental row-model migration. Grouping is an interactive act here — a user drags a column into the group panel while reading their rows — and collapsing on drop hid the data they were just looking at.

  Pass `initialExpansion` to choose another policy. `{ kind: "through-depth", depth: 0 }` opens only the top level and is the one to reach for when the grouped population is too large to draw at once.

## 0.5.2

## 0.5.1

## 0.5.0

### Minor Changes

- Release the work merged since 0.4.0. Ten commits landed on `main` without changesets and so were never published; this releases them together. ([#330](https://github.com/cacheplane/pretable/pull/330))

  **Row model (#321)** — the incremental row-model migration completes, changing public surface in `@pretable/core` (grid construction, the local row model, and the exported types).

  **Cell presentations (#318, #319)** — the semantic ramp and the first cell presentations, then badge and entity presentations, added to `@pretable/react`'s public API.

  **Theming (#322)** — `pretable.css` is the house theme and the documented default; Excel and Material become compatibility skins.

  **Fixes (#324, #325)** — a focused cell now draws exactly one ring rather than two, which also restores the pinned-column seam the duplicate ring had been evicting from its `box-shadow` slot; the Material dark checkmark moves from 1.70:1 to 7.73:1 contrast; and the row-height floor follows `--pretable-row-height` instead of a hard-coded 44px, so a themed density change is honored by measured and estimated rows alike.

## 0.4.0

### Minor Changes

- Add opt-in native number formatting with locale-aware money and accounting presets, aggregate inheritance, and matching clipboard output. ([#317](https://github.com/cacheplane/pretable/pull/317))

## 0.3.2

## 0.3.1

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

## 0.2.0

## 0.1.1

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

## 0.0.14

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

## 0.0.12

## 0.0.11

### Patch Changes

- Reconcile the selection when the drawn column model changes, so grouping or ([#264](https://github.com/cacheplane/pretable/pull/264))
  ungrouping no longer drops full-row selections, double-toggles a row, or copies
  a single column instead of the whole row.

- Stop invalidating the derived rows for a re-created `value` closure on a grid ([#264](https://github.com/cacheplane/pretable/pull/264))
  that is not grouped by that column. An inline `columns={[…]}` array no longer
  emits — and no longer destroys `visibleRows` identity — on every parent update.

- Reconcile the selection when a column is reordered, pinned, or the layout is ([#264](https://github.com/cacheplane/pretable/pull/264))
  reset. A range does not need to lose a column to break — it only needs the
  columns between its endpoints to change — so dragging a header used to leave a
  selected row half-checked and make Cmd+C copy the wrong columns, with no
  grouping involved at all.

## 0.0.10

## 0.0.9

### Patch Changes

- Fix row grouping selection, focus, clipboard output, and treegrid accessibility, ([#259](https://github.com/cacheplane/pretable/pull/259))
  including keyboard grouping controls and expansion announcements.

## 0.0.8

## 0.0.7

### Patch Changes

- Render grouped rows with a derived group column, aggregate formatting, and the ([#255](https://github.com/cacheplane/pretable/pull/255))
  ARIA treegrid keyboard model. Grouped grids now expose expandable hierarchy
  rows with themed indentation and keep focus anchored when groups collapse.

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

## 0.0.5

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

## 0.0.3

### Patch Changes

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

## 0.0.2

### Patch Changes

- Add MIT license metadata, repository links, homepage links, and issue tracker ([#104](https://github.com/cacheplane/pretable/pull/104))
  metadata to the public packages as part of the open-source community health
  pass.

## 0.0.1

### Patch Changes

- Initial release. Pretable's wrapped-text scroll wedge (4× faster than Grid Alpha on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs Grid Alpha's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives. ([#58](https://github.com/cacheplane/pretable/pull/58))

  See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.
