# @pretable/core

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
