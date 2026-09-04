# @pretable/ui

## 0.15.3

### Patch Changes

- The grid now answers two platform accessibility settings it was ignoring, and ([#578](https://github.com/cacheplane/pretable/pull/578))
  every theme declares its `color-scheme`.

  **Forced colours (Windows High Contrast).** A range selection was invisible.
  The fill is a translucent `background-image`, and forced colours drop the image
  and force the colour underneath to `Canvas` — so eleven selected cells came out
  identical to no selection at all, with only the single focused cell marked, and
  what the grid was about to copy could not be read off the screen. Selected cells
  now take `Highlight`/`HighlightText`, the pair the platform guarantees against
  each other, with `forced-color-adjust: none` so Chromium's text backplate does
  not paint an opaque rectangle over every word (it did; the computed styles were
  identical either way and only a screenshot told them apart). Descendants inherit
  the cell's colour, so a red P&L inside a selection cannot paint itself onto the
  fill at whatever contrast it happened to have. Disabled menu items take
  `GrayText`. The rest of the grid needed nothing: the border cage carries the
  structure, the row-select glyph is drawn in `currentColor`, and the frozen edge
  falls back to the pinned cell's own border.

  **Reduced motion.** `grid.css` animated three things and offered no way out; a
  consumer cannot patch that without re-implementing rules they do not own. All
  three are decoration and are now switched off under
  `prefers-reduced-motion: reduce`, with a guard that fails if a future animation
  is not named there too.

  **`color-scheme`.** Only `pretable.css` declared it, so an Excel- or
  Material-themed grid kept light scrollbars and a light `<select>` popup inside a
  dark app — the one part of the surface a theme cannot reach with a custom
  property. Both now declare it, Material in each mode it ships.

## 0.15.2

### Patch Changes

- The grid's list-shaped menus — the tool panel's column kebab (pin placement + ([#573](https://github.com/cacheplane/pretable/pull/573))
  auto width), the `+ Add group` menu and the header's `⋮` — now size to their
  own labels, dim the item that is already the current state, and rule off the
  mode bit from the commands.

  All three shared `popoverStyle`, which stamps a fixed 240px width: the right
  call for `FilterMenu`, a dialog whose form controls stretch to their container,
  and wrong for a menu of four short labels, which was drawn as a mostly empty
  rectangle spilling well past the grid. Menus now take `menuPopoverStyle` —
  content width between a 160px floor and the dialog's 240px, still clamped
  horizontally against 240 so the right edge stays safe without measuring.

  The pin menu disables the placement the column is already in, but
  `[data-pretable-menu-item]` had no disabled treatment at all: the disabled item
  kept the enabled color, the pointer cursor, and the hover highlight, so the one
  item that cannot be chosen read as the obvious one to click. It now takes the
  tool pane's standard disabled treatment (`--pretable-text-dim`, default
  cursor), and the hover rule skips it.

  `ColumnRowMenu` gained a `role="separator"` between the one-shot pin commands
  (which close the menu) and the auto-width checkbox (which stays open) —
  `[data-pretable-menu-separator]`, styled by `grid.css`, and not a focus stop.

  The same pass over the rest of the portaled surfaces, which cannot inherit
  anything from the grid:

  - The header's filter dialog declared `font: inherit`, a shorthand that pulls
    the HOST PAGE's size and line-height in — so it drew at the consumer's body
    font (16px on our own site) while every other popover sat at
    `--pretable-font-size-cell`. It now declares the whole trio, as the enum
    listbox and date popover already did, and `[data-pretable-column-menu]`
    gained the `color` it was missing.
  - The dialog's operator `<select>` and value `<input>` were 28px and 33px in a
    stacked pair, because Chrome forces `line-height: normal` on a select and
    ignores what it is given. Both now take one explicit `block-size`, the way
    the tool pane's identical controls already do.
  - Those fields kept the UA focus ring, which takes the CONSUMER's
    `accent-color` — a different colour, width and offset from the ring on the
    same controls in the tool pane. They now take `--pretable-focus-ring`.
  - The column-reorder ghost is a copy of a header cell but declared neither
    size nor weight and took the cell colour, so the label under the cursor was
    bigger and lighter than the column it came from. It now mirrors the header.
  - The date editor's month steppers disable at the calendar's min/max month
    with no disabled treatment and a live hover accent — the menu items' defect
    in a second place. Fixed the same way.

  `grid.css`'s "portaled popovers declare the sans font themselves" guard is why
  only half of this was caught: it checked `font-family` alone. It now checks
  size and colour too, rejects the `font: inherit` shorthand, and is joined by
  guards for the ghost's header type, the disabled treatment, the hover
  guards, and the dialog's focus ring — each mutation-tested to fail.

- The frozen-column seam now runs through the header row instead of starting ([#575](https://github.com/cacheplane/pretable/pull/575))
  below it.

  `--pretable-seam-color` was drawn by `[data-pretable-cell][data-pretable-pinned]`
  only. The pinned HEADER cells took the opaque `--pretable-bg-header` fill and
  nothing else, so the shadow that marks the frozen edge stopped dead at the
  header — a header-tall gap at the top of a boundary that is meant to run the
  height of the grid, visible on any grid with a pinned column and a horizontal
  scroll. The header's pinned rule is now split per side, each carrying the
  mirrored offset its body counterpart has.

  The guard that should have caught this named `[data-pretable-cell]` alone; it
  now covers the header rules too, on both sides, and checks that the seam did
  not cost the opaque fill.

- The frozen-column seam is now one continuous edge instead of a shadow that ([#577](https://github.com/cacheplane/pretable/pull/577))
  faded out at every row boundary.

  It was a `box-shadow` on each pinned CELL, and a per-cell shadow cannot tile.
  The blur has to stay inside the cell — a spread any less negative bleeds above
  and below it and doubles into a dark band at each boundary — so the seam faded
  to nothing once per row and read as a dashed edge rather than a frozen pane's.

  grid.css now draws it as one full-height gradient per plane: the sticky header
  row and the scroll content, meeting exactly at the header's lower edge. A
  gradient has no falloff along its own axis, so each box is uniform for its
  plane's whole height. The surface publishes where each edge falls
  (`--pretable-pinned-left-edge` / `--pretable-pinned-right-edge`, gated by
  `data-pretable-pinned-left` / `-right`), taking the right-hand one through the
  same `getPinnedRightEdge` the right-pinned cells use so the seam cannot land a
  pixel off the column it marks. `--pretable-seam-color` still colours it, and a
  side with nothing pinned draws nothing.

## 0.15.1

## 0.15.0

## 0.14.4

## 0.14.3

## 0.14.2

## 0.14.1

## 0.14.0

## 0.13.1

## 0.13.0

## 0.12.1

## 0.12.0

### Patch Changes

- Styles for the tool panel's pane-resize handle: a slim strip on the pane/grid seam (`data-pretable-pane-resize`) with a hover/focus tint over existing tokens, a `col-resize` cursor, and a 24px hit area on coarse pointers. ([#539](https://github.com/cacheplane/pretable/pull/539))

## 0.11.0

### Minor Changes

- Modernize the public package build architecture and support both React 18 and ([#537](https://github.com/cacheplane/pretable/pull/537))
  React 19. All public packages retain first-class ESM and CommonJS package-name
  imports, with an explicit ES2018 syntax and runtime API compatibility contract.
  Generated filenames and private `dist` paths are not stable or supported; use
  the documented package root and exported subpaths.

- Tool panel: a rail-and-pane shell on `PretableSurface`, on by default, opening ([#486](https://github.com/cacheplane/pretable/pull/486))
  with a columns section.

  The rail is a strip of section tabs docked at the grid's right edge, inside the
  card; selecting a tab opens a 264px pane between the body viewport and the
  rail. The rail borrows the header's surface and the pane the toolbar's, so the
  panel reads as chrome, not content. It ships enabled — `toolPanel={false}`
  removes it — and `PretableToolPanelConfig` drives the open section either way:
  `activeSection`/`onActiveSectionChange` controlled, `defaultActiveSection`
  uncontrolled. The `<Pretable>` preset passes the prop through, which retires
  its documented "no configuration UI" limitation.

  The columns section lists every column, subgrouped by pin state: a checkbox
  toggles visibility (the engine's new `hidden` flag and `setColumnVisible`,
  released alongside in `@pretable/core`, so width, pin state and relative order
  survive a round trip), a search box filters the list, "Reset columns" restores
  the mount-time configuration, and a per-row kebab menu offers the three pin
  placements. Rows reorder by dragging the grip or with Shift+ArrowUp/Down on it;
  Escape abandons an in-flight drag or keyboard move without touching the engine.

  In `@pretable/ui`, the card chrome — border, radius, shadow — moves up from the
  scroll viewport onto a layout wrapper that encloses viewport, pane and rail, so
  the docked panel sits inside the card rather than bolted onto it; the boxes
  inside surrender their own copies and meet at hairlines. A grid rendered
  without the panel paints identically to before.

- Tool panel: a filters section on the rail, building the query's AND/OR tree. ([#494](https://github.com/cacheplane/pretable/pull/494))

  `ToolPanelSectionId` widens to `"columns" | "filters"`, and the rail grows a
  second tab. The pane it opens is a filter builder over `query.filters` as the
  engine holds it — leaves, groups, and nesting — rather than the per-column view
  the header funnel offers:

  - A row per leaf: column, operator, and a value control typed off the column
    (`text`, `number`, `date`, a checklist for enums and booleans). The operator
    vocabulary is the funnel menu's, so the same filter reads identically in both
    places, and a column's `filterOperators` prunes both lists.
  - `+ filter` and `+ group` at every level; the join between siblings is one
    control per run, because a sibling list has exactly one connective.
  - Commits are live — discrete changes at once, a value the user is still typing
    after a short dwell — so there is no Apply button. A row whose operator has no
    operand yet holds its place as an empty group, which constrains nothing: an
    unfinished row never moves the grid.
  - Enum columns that declare no `options` load their choices through the
    surface's distinct-value path, and inherit its incomplete-universe warning
    under external filtering.
  - The section subscribes to the row model itself, so a filter committed
    elsewhere — a header funnel, a controlled `query` — is reflected in the panel
    as it lands.

  Every string the section renders is a message, resolved off the `messages`
  prop like the rest of the grid: `toolPanelFiltersLabel` for the tab,
  `toolPanelAddFilterLabel`/`toolPanelAddGroupLabel` for the add pair,
  `toolPanelFilterWhereLabel`/`toolPanelFilterJoinLabel` and the join's action
  sentence, the control labels, the remove button, and the nesting refusal.

  `@pretable/ui` ships the section's rules — the row grid, the run rail and its
  join control, the nested-group indent, and the refusal styling for a disabled
  add action.

- Tool panel: a grouping section on the rail — the third pane. ([#507](https://github.com/cacheplane/pretable/pull/507))

  `ToolPanelSectionId` widens to `"columns" | "filters" | "grouping"`, and the
  rail grows a third tab. The pane holds four blocks, top to bottom:

  - A **group-by list**: one row per grouping level, in level order — add a
    level from the `+ Add group` menu (any data column not already grouped),
    remove one with its ✕, reorder by dragging the grip or with
    `Shift+ArrowUp`/`Shift+ArrowDown` on it. The list is a pure projection of
    the query's `rowGroups` — the same model the drag-to-group strip writes, so
    the two surfaces never disagree.
  - **Expand all / Collapse all**, disabled while nothing is grouped.
  - A **Hide grouped columns** switch over the engine's `hideGroupedColumns`.
    A consumer who keeps driving the surface prop of the same name after mount
    retains ownership — the prop writes back and clobbers pane writes; one who
    leaves it alone after mount cedes the state to the pane.
  - A per-column **aggregate picker** (rows mode only — in explicit-model mode
    the block is absent, since the caller owns their row model and an override
    would change nothing a group row shows). Options are `Default (…)` — no
    override, showing what the column's prop declares — `None`, and the
    type-valid builtins (number columns: Sum/Average/Min/Max/Count; every other
    type: Count). `None` writes the new `null` override, meaning "show no
    aggregate"; `Default (…)` clears the override entirely, so "no override"
    and "overridden to the same value" never look alike.

  A grouped column also gains a quiet "grouped" marker in the filters section's
  column picker, shown only while the column is not drawn (grouped with
  hide-grouped on) — distinct from the "hidden" marker, which wins when both
  apply.

  Every string the section renders is a message: `toolPanelGroupingLabel` for
  the tab, the group-by labels (`toolPanelGroupByLabel`,
  `toolPanelAddRowGroupLabel`, `toolPanelRemoveGroupLabel`,
  `toolPanelReorderGroupLabel`, `toolPanelNoGroupsMessage`), the expansion pair,
  `toolPanelHideGroupedColumnsLabel`, the aggregate strings
  (`toolPanelAggregatesLabel`, `toolPanelAggregateColumnLabel`, the
  `Default`/`None`/`Custom` options, and the five builtin names), and
  `toolPanelColumnGroupedMarker` for the filters-picker marker.

  `@pretable/ui` ships the section's rules — the group-by rows and their grips,
  the expansion button pair, the switch row, and the aggregates block.

## 0.10.0

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
