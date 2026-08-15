# @pretable/ui

## 0.9.0

## 0.8.0

## 0.7.0

## 0.6.2

## 0.6.1

## 0.6.0

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

- Add `@pretable/ui/themes/pretable.css`, a first-party house theme. ([#308](https://github.com/cacheplane/pretable/pull/308))

  Excel and Material are imitations of other products. This one is the grid's own voice, and its
  identity is craft rather than hue: hairline rules, horizontal-only separation, a quiet header, honest
  elevation, and a single functional interaction colour that reads as a system convention rather than a
  brand.

  The reference designs get away with near-invisible hairlines because their tables sit on a grey page.
  pretable never paints the host's page, so it paints its own canvas _inside_ the component: the header
  rail and the drag-to-group strip are tinted 1.14:1 off the data surface, which is what lets the rules
  stay hairlines and gives them something to read against. Group rows sit half a step off that canvas,
  so they read as structure without flattening into the records they contain, and pinned columns stay
  the same white as the data — a frozen column is data, not chrome.

  Vertical rules are dropped entirely (`--pretable-rule-vertical: transparent`); the frozen-column edge
  is carried by `--pretable-seam-color` instead. That matters more as rows get taller, where a vertical
  divider becomes a long empty channel running through whitespace.

  Ships all 45 contract tokens at `:root` plus `--pretable-group-indent`, a `[data-theme="dark"]` block
  that restates every colour rather than aliasing, and three `[data-density]` tiers. Default density is
  standard: 48px rows under a 52px header.

  Existing themes are untouched. One change reaches beyond the new file: `--pretable-shadow-card` was
  declared by every theme and consumed by nothing, so the grid's container now actually applies it.
  That lets a theme separate the grid from the host page with elevation instead of a drawn frame —
  which the frame alone cannot do, because `--pretable-rule-strong` is also the sticky header's
  underline and owes 3:1 there. Excel and Material set it to `none` and are visually unchanged; a
  third-party theme that already declared a real value will now see it paint.

## 0.3.2

### Patch Changes

- Wire the frozen-column seam, and stop it notching group bands. ([#299](https://github.com/cacheplane/pretable/pull/299))

  `--pretable-shadow-seam` was declared by every theme and read by nothing. That left a latent hole:
  a theme that drops the vertical rule **and** gives `--pretable-bg-pinned` no tone step has no
  frozen-column boundary at all — and because unpinned cells scroll underneath pinned ones, text would
  appear clipped mid-glyph at an invisible line. Both shipped themes escape only because they mark
  that edge twice over, with a tone step and a vertical rule.

  It is renamed `--pretable-seam-color` and now holds a colour rather than a whole shadow. The right
  edge needs the mirror of the left edge's offset, and a single shadow value cannot be reversed, so
  `grid.css` owns the geometry — which is structural — and the theme owns the strength. Excel and
  Material set it to `transparent` and are visually unchanged.

  Also fixes a defect introduced when pinned cells and group rows got their own surface tokens: both
  pinned rules follow the group-row rule at equal specificity, so any theme that stops aliasing
  `--pretable-bg-pinned` and `--pretable-bg-group-row` together would see a frozen column punch a
  visible notch through every group band. The shipped themes were immune only by accident.

  Custom themes: rename `--pretable-shadow-seam` to `--pretable-seam-color` and give it a colour
  (`transparent` opts out).

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

## 0.3.0

## 0.2.0

## 0.1.1

### Patch Changes

- Give the grid a real surface and elevation vocabulary, and fix three bugs it exposes. ([#288](https://github.com/cacheplane/pretable/pull/288))

  Pinned body cells and group rows no longer borrow `--pretable-bg-header`; they have
  `--pretable-bg-pinned` and `--pretable-bg-group-row`. Small affordances no longer borrow the card's
  `--pretable-radius`; they have `--pretable-radius-control`, because a 12px card radius renders a
  14px button as a circle. And `--pretable-reorder-ghost-shadow` — four of whose five uses were
  popovers, not drag ghosts — is renamed `--pretable-shadow-overlay`, joined by
  `--pretable-shadow-card` and `--pretable-shadow-seam`.

  Every new token defaults to the value Excel and Material already resolved, so **neither theme
  changes appearance**, verified in a browser across light and dark. The exception is Material's small
  controls, which stop being circles.

  Three fixes. Row hover was declared before the pinned-cell rules and, since every selector in
  `grid.css` is `:where()`-flattened to specificity zero, lost to them — so hovering a row left its
  frozen columns unhighlighted and the row visibly broke in half at the pinned edge.

  Fixing that exposed a worse one. Hover and selection are translucent state layers, and both replaced
  the surface fill rather than tinting it. Pinned cells are `position: sticky` with unpinned columns
  scrolling underneath, so a hovered or selected pinned cell lost its opacity and let the scrolled-under
  column print straight through it — under Excel, whose hover is `transparent`, completely. Both now
  paint into the `background-image` layer and compose over whatever surface colour is beneath, which
  also means hover finally tints a zebra row instead of erasing its stripe.

  Third: Material's dark mode never overrode the shadow token, so every dark-mode menu, popover and
  listbox cast a black shadow onto a near-black surface and nothing read as lifted.

  If you have a custom theme, rename `--pretable-reorder-ghost-shadow` to `--pretable-shadow-overlay`
  and add `--pretable-bg-pinned`, `--pretable-bg-group-row`, `--pretable-radius-control`,
  `--pretable-shadow-card` and `--pretable-shadow-seam`. Aliasing the two surface tokens to
  `--pretable-bg-header` reproduces the old appearance exactly.

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

- Let header dividers inherit `--pretable-rule` from the grid skin instead of a ([#252](https://github.com/cacheplane/pretable/pull/252))
  fixed inline color, so they match body gridlines in light and dark themes and
  respond to consumer token overrides.

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
