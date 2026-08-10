# pretable default theme & design system — design

**Date:** 2026-08-09
**Branch:** `blove/pretable-design-theme-c7bc23`
**Status:** approved for implementation

## Problem

pretable ships two themes — `excel.css` and `material.css` — and no house style. The website
picks Material, the bench picks Excel, and a consumer's first styling decision is _which other
product should my grid look like?_ There is no theme that represents pretable itself.

Reviewing the token contract against a reference set of dashboard designs surfaced ten defects,
two of which are outright bugs. The reference's discipline — hairline rules, tabular figures,
a quiet header, elevation instead of borders — is not reachable from the current token set at all.

## Decisions

1. **Full scope.** Foundation, house theme, and cell-presentation primitives all land, decomposed
   into four sequenced sub-projects.
2. **`pretable.css` becomes the documented default.** Excel and Material are reframed as
   compatibility skins — imitations meant to disappear into a host design system. They are _not_
   retuned toward the reference brief; that would destroy their reason to exist.
3. **Right-side pinning is a shipped feature and stays.** Earlier notes claiming otherwise were
   stale. Verified: `core.api.md:117` (`pinned?: "left" | "right"`), `:263`
   (`setColumnPinned(id, "left"|"right"|null)`), right-pin geometry at
   `packages/react/src/styles.ts:137-205`, guard `packages/react/src/__tests__/right-pin-surface.test.tsx`,
   docs at `apps/website/content/docs/grid/index.mdx:75`. Any seam treatment must handle both edges.
4. **Header height 52px** at standard density (rows 48px). With the header fill removed, separation
   rests on one hairline and the rail needs the extra air to read as chrome rather than as a first
   data row. Density tiers 44 / 52 / 60 satisfy the strict-growth guard.

_Added 2026-08-10, after reviewing the running site:_

5. **Ship a first-party stroked icon set.** There is no icon set today — there are three
   incompatible rendering systems. Two _filled_ SVGs (the funnel and the ⋮), both authored on a 16
   grid and rendered at 11px so every edge lands on a fractional pixel; four Unicode text glyphs
   (`▲`/`▼` sort, `▾` twisty, `✓` checkbox and boolean cell) which re-render in whatever font the
   theme picked, so their size, weight and baseline change between Excel's Aptos and Material's
   Roboto and across platforms; and a CSS `radial-gradient` for the chip grip dots. Nothing can give
   them a shared stroke weight or optical size. Replace all of it with ~8 inline SVG glyphs on one
   16px grid: 1.5px stroke, rounded caps and joins, `currentColor`, sized from a token. **No icon
   library dependency** — that remains rejected on bundle, licensing and tree-shaking grounds.
6. **The container edge becomes a hairline plus real elevation**, not a drawn frame. Today it is
   `1px solid var(--pretable-rule-strong)` with no shadow, which under Material resolves to
   `rgb(121,121,121)` — a mid-grey box around the hero grid. Excel keeps its frame and sets
   `--pretable-shadow-card: none`.
7. **The homepage visual pass lands inside SP2**, not as a separate quick PR, so the demo changes
   once, coherently, rather than twice.

## Verified current state

Every claim below was confirmed against the tree at `e7fcc97`.

- **The token contract is 37 tokens**, held by a presence list in
  `packages/ui/src/__tests__/contract.test.ts` that asserts each resolves at `:root` under both
  themes. It is not an exact count, and it is one-directional: nothing catches a theme-defined
  token that no stylesheet reads.
- **`data-pretable-numeric` is never emitted.** It appears only in the rule that styles it
  (`packages/ui/src/grid.css:239-245`). `packages/ui/README.md:54` nonetheless advertises it as
  part of the public attribute contract. The original design doc predicted this exact outcome:
  _"depends on whether the column-config API lets a column declare itself numeric; if not, this
  rule waits"_ (`docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md:578`).
  It waited fifteen months.
- **One radius token serves twelve sites**, from the grid container to a 14px chip-remove button.
  The checkbox additionally hard-codes `3px`, ignoring the theme entirely.
- **One shadow token serves five sites**, four of which are popovers. It is named
  `--pretable-reorder-ghost-shadow`. Material's dark block never overrides it, so dark-mode
  popovers cast black onto a near-black surface.
- **`--pretable-rule` colors both axes** — the horizontal row hairline (`grid.css:94`) and the
  vertical column divider (`:55`, `:93`). No theme can drop the cage without losing row separation.
- **`--pretable-bg-header` has five consumers**: the header strip (`:42`), pinned header cells
  (`:72`), group rows (`:119`), pinned body cells (`:192`, `:198`), and the number steppers
  (`:801`) — plus `--pretable-reorder-ghost-bg` aliases it in both themes.
- **Header cells are `<button>` with no background reset.** `grid.css:47-57` sets `border: 0` but
  never a background; both apps only look correct because they import Tailwind's Preflight. A live
  DOM read of the bench confirmed the computed value is `rgba(0,0,0,0)` there.
- **Two rules never paint.** The selection background at `:214` loses to the `aria-selected` rule
  at `:231` (equal specificity, later in source, set from the same condition) — but its
  `color: var(--pretable-text-selected)` line _is_ live and must be preserved. The focus outline at
  `:220` is neutralized on data cells by an inline `outline: "none"`
  (`packages/react/src/pretable-surface.tsx:3541`), while group cells, which set no inline outline,
  receive a doubled ring.
- **`[data-pretable-toolbar]` and `[data-pretable-status-bar]` are styled but never emitted.**

## Sub-projects

Sequenced. Each gets its own plan and PR; later ones depend on tokens introduced earlier.

### SP1 — Line vocabulary and numeric alignment

The foundation. No new theme, no palette change; existing themes keep their current appearance.

- Add `--pretable-rule-vertical` and `--pretable-rule-width`. Retint `grid.css:55`, `:93`, `:210`
  to the vertical token; `:94` keeps `--pretable-rule`. Excel sets vertical = `--pretable-rule`
  and keeps its cage.
- Add `align?: "start" | "center" | "end"` to `PretableColumn`. Emit
  `data-pretable-column-type` and `data-pretable-column-align` on body cells, header cells, and
  group-row aggregate cells. (Namespaced `-column-` so they sit alongside the existing
  `data-pretable-column-id`. They were renamed from the shorter `data-pretable-type` /
  `data-pretable-align` during SP1 implementation in response to code review; the `-column-`
  spellings are what shipped and are the names later sub-projects must style.)
- `data-pretable-column-align` is **absent** for the default start case — `resolveColumnAlign`
  returns `undefined` unless the column sets `align` explicitly or is a `number` column. Style the
  default off the attribute's absence; a `[data-pretable-column-align="start"]` rule matches only
  columns that opted in by hand.
- Alignment must use **`justify-content`**, not `text-align`. Cells are flex containers and an
  unwrapped value is an anonymous flex item, which `text-align` cannot move. Use
  `justify-content: safe flex-end` — plain `flex-end` clips an over-wide number at its _leading_
  edge, silently turning `1,234,567` into a legible, plausible, wrong `34,567`.
- **Keep** the header's inline `textAlign: "left"` (`pretable-surface.tsx:2986`). It blocks nothing
  — `justifyContent` is not in that inline style — and removing it exposes the UA
  `button { text-align: center }` for every column.
- Apply `font-variant-numeric: tabular-nums lining-nums` to number and date cells. Do **not** switch
  to `--pretable-font-mono`; one family, with tabular figures doing the alignment.
- Delete the dead `[data-pretable-numeric]` rule and correct `packages/ui/README.md:54`.
- Fix the header-button background. Delete the two dead toolbar rules and the never-painting
  selection background, preserving its `color` line.
- Exclude `[data-pretable-group-cell]` from align rules — it owns the twisty indent.

Guards: `css-cascade.test.ts:43-45` asserts the literal `:55` rule body and must be rewritten.
`contract.test.ts` needs the two new tokens. API Extractor reports for `core` and `react` must be
regenerated — `API Extractor — report freshness` is a required check. Build before `pnpm api`, or a
stale `dist/` silently strips exports.

### SP2 — Surface and elevation system

- Split `--pretable-bg-pinned` and `--pretable-bg-group-row` out of `--pretable-bg-header`.
- Add `--pretable-radius-control` for the 14-18px affordances; kill the `3px` checkbox literal.
- Rename `--pretable-reorder-ghost-shadow` → `--pretable-shadow-overlay` (four of its five uses are
  popovers). Add `--pretable-shadow-card` and `--pretable-shadow-seam`. Override the overlay shadow
  in Material dark.
- Pinned seam on **both** edges. The left-side occlusion trick does not mirror: on the right the
  affordance must escape the _first_ right-pinned cell's leading edge, which later right-pinned
  cells in the same `z-index: 1` tier paint over. Vertical bleed also needs `spread ≤ -blur/2` or
  every row boundary inside the pinned region gets a dark band.
- Express hover and range selection as `background-image: linear-gradient(...)` so state composes
  over surface. **This requires rewriting `grid.css:92`, `:111`, `:119`, `:192`, `:198` from the
  `background` shorthand to `background-color`** — the shorthand resets `background-image: none`,
  which would wipe the wash on pinned cells. Zebra-on-pinned remains out of reach either way; both
  are surface fills competing for one slot.
- Excel sets `--pretable-shadow-card: none`; it declares `--pretable-radius: 0` and must not float
  on a drop shadow.
- **Deferred from SP1 — the focus ring is both dead and doubled.** `grid.css:237`'s outline rule,
  keyed on `[data-pretable-cell][data-pretable-focused="true"]`, never paints on data rows:
  `packages/react/src/pretable-surface.tsx:3595` sets an inline `outline: "none"` on every body
  cell, and inline style beats a layered `:where()` rule. Group-row cells (`group-row.tsx:137-138`)
  carry the same `data-pretable-cell` / `role="gridcell"` / `data-pretable-focused` attributes but
  set **no** inline outline, so they receive both that outline _and_ the
  `[role="gridcell"][data-pretable-focused="true"]` inset `box-shadow` at `:252` — two focus rings,
  at different offsets, on group rows only. This is a **live accessibility defect, not only dead
  CSS**: the focus indicator is visually inconsistent between row kinds, so its weight reads as
  meaning something it does not, and one of the two rings is unthemeable in practice because no
  theme can suppress an inline `none`. The fix is to pick one mechanism — drop the inline
  `outline: "none"` so `:237` governs both, or drop `:237` and let the inset shadow govern both —
  not to add a third.

#### SP2b — the first-party icon set

Roughly eight glyphs, all inline SVG on one 16px grid, 1.5px stroke, rounded caps and joins,
`fill: none`, `stroke: currentColor`, sized from `--pretable-icon-size` (default 14px). No
dependency; one small module in `@pretable/react`.

Glyphs needed, replacing what is there now: **funnel** (currently a filled SVG), **⋮ overflow**
(filled circles — keep circles, they are correct at this size, but move onto the shared grid),
**chevron** for the group twisty (replaces the Unicode `▾`, and the existing CSS rotation still
works), **sort ascending/descending** (replaces `▲`/`▼`), **check** (replaces `✓` in both the
row-select checkbox and the boolean cell), **close/×** for the chip remove, and **grip** for the
chip handle (replaces the `radial-gradient`).

Two behavioural changes ride along, both visible on the running site:

- The reveal rule is keyed on `[data-pretable-header-row]:hover`, so hovering any single header
  lights every funnel in the grid at once. The original comment explains why a `~` selector
  over-matched — but since SP1, header cells and their overlay slots both carry
  `data-pretable-column-id`, so per-column scoping is now reachable. Fix it or record why not.
- Sort indicators currently render beside every sortable label. The reference shows an affordance
  only on the actively sorted column; the rest stay quiet until hover.

Accessibility: every glyph stays `aria-hidden`, because each already sits inside a button with an
`aria-label` or beside `aria-sort`. Do not add titles that would double-announce.

#### SP2c — the homepage visual pass

Apply the system to the hero once the tokens exist, in this order. Measured on the running site:
of 153 rendered cells, **zero** carry alignment, because the hero's numeric columns never declare a
type.

1. Add `type: "number"` to `qty`, `last`, `mktValue`, `dayPnl`, `weight` in
   `apps/website/app/components/heroGrid/positionColumns.tsx`. This is the single largest
   readability change on the page and needs no new tokens.
2. Set `--pretable-rule-vertical: transparent` for the site — reachable since SP1.
3. Quiet the header: ~12.5px, muted, unfilled.
4. Un-grey the pinned Symbol column via `--pretable-bg-pinned` plus the seam shadow. **Verified by
   live CSS injection:** with the header white, the pinned column currently reads as a grey stripe,
   because it borrows `--pretable-bg-header`. This is the clearest argument for the surface split.
5. Container edge to hairline plus `--pretable-shadow-card`.

Leave alone: the `Day P&L` two-line value-over-delta stack already does the reference's metric
pattern well, and the `trim`/`watch`/`hold` pills are the reference's badge pattern hand-rolled in
app CSS — they are the natural first SP4 primitive, not an SP2 edit.

### SP3 — `pretable.css` and the docs sweep

- New theme defining **all** contract tokens at `:root` plus a dark block covering every color
  token. The dark block must not omit `edit-bg`, `bg-header`, or the checkbox tokens, or a white
  editor survives into dark mode.
- Four semantic tokens: `--pretable-positive`, `--pretable-negative`, `--pretable-warning`,
  `--pretable-info`. Every value must clear **4.5:1** against its own theme's grid surface. Excel's
  Office-brand mustard `#bf8f00` is 2.94:1 on white and must not be used; Material's tonal analog
  `#7d5700` (6.33:1) is the pattern to follow. `--pretable-text-dim` must also clear 4.5:1 — it is
  real text in ten places, and the reviewed proposal's `#a1a1aa` (2.56:1) fails.
- Add `color-scheme: light` / `dark`. There are currently zero declarations repo-wide, and
  `grid.css:409-412` styles `select` and `input[type=date]` inside a body-portaled filter menu.
- **Hairlines require a tinted header.** The reference's borders read as invisible because its cards
  sit on a gray canvas; the grid sits on the consumer's page and pretable never paints that canvas.
  A near-white `--pretable-rule-strong` on a white header leaves the sticky header separated from
  scrolling rows by ~1.2:1. Keep the header tinted, or use `--pretable-bg-inset`.
- **Group rows need their own fill before the header loses its.** They borrow the header token
  deliberately so the eye reads them as structure; flatten it and, with muted header text, they read
  as _less_ prominent than the records they contain.
- Packaging: `package.json` exports, `scripts/copy-css-assets.mjs`, and
  `build-config.test.ts` — which pins `cssExports` with `toMatchObject` (`:70`) and the
  `lint:packaging` script with `toBe` (`:82`). `contract.test.ts`'s three loops are hardcoded to
  `["excel.css", "material.css"]` and must include the new theme.
- Docs: `token-reference.mdx` hardcodes a token count in three places and describes
  `--pretable-rule` as "Gridline color (between cells)", wrong once it is horizontal-only. Also
  `pick-a-theme`, `custom-themes`, `light-dark`, and `README.md:42-46`.

### SP4 — Cell presentation primitives

`@pretable/ui/cells.css` plus thin React components for badge, status dot, numeric delta, segmented
meter, and two-line entity stack.

- The delta chip is **not** a filled 16px circle. At a 96-120px numeric column that plus a value
  plus a comparison string overflows, and at Excel's 20px row the circle is 80% of row height.
  A colored `::before` glyph costs zero DOM nodes per cell and carries the same information.
- Requires a `column.renderAggregate` addition and a fix to a real measurement bug:
  `measureRenderedRowHeight` (`packages/react/src/row-height.ts`) measures only
  `[data-pretable-wrap="true"]` cells when any exist, falling back to all cells only when none do.
  So a two-line stack in a non-wrap column, in a row that _also_ has a wrap column, is measured at
  single-line height and clipped — in browsers only, invisible to jsdom.

## Explicitly rejected

- **A page-canvas token.** The grid renders a card; the consumer owns the page. Shipping a token the
  library never applies repeats the `data-pretable-numeric` failure exactly. Document the canvas
  color the theme was designed against and stop.
- **Mass token rename** (`bg-grid` → `surface`, etc.). Buys naming aesthetics, costs every doc table
  and consumer example, moves zero pixels. Rename only where the name is a lie.
- **Row-as-card tables.** Rows are absolutely positioned against a prefix-sum index with integer
  heights; a gap must fold into row height, corrupting reveal math and wrapped-text measurement, and
  it cannot survive pinning — a card corner scrolling under a sticky column reads as broken. The
  transferable half, an unfilled header with muted labels, _is_ adopted.
- **A categorical color ramp.** A grid renders one column at a time; it has no series. Categorical
  color is a chart concern and stays app-side.
- **Icon tiles, an avatar tile, and an icon set.** A 36px tile does not fit a 40px compact row, and
  this is content, not chrome. pretable ships zero icons today; every glyph is a literal character.
- **Toolbar, segmented controls, metric cards, primary-action fill.** Not chrome pretable has. The
  grid's entire button inventory is five 14-18px monochrome affordances.
- **A letter-spacing token.** The brief's tight tracking applies to 34-40px hero metrics; at 13-15px
  it is noise, and it perturbs the advance widths that `text-core` and the row-height estimator are
  calibrated against.

## Testing

Each sub-project extends the existing guards rather than adding a parallel suite: `contract.test.ts`
for token presence and resolution, `css-cascade.test.ts` for the `@layer` / `:where()` contract,
`attribute-contract.test.tsx` for the `data-pretable-*` namespace, and
`apps/bench/tests/cascade-override.spec.ts` for real-browser cascade behavior. SP1 and SP2 both
touch cascade-sensitive rules, so the Playwright cascade spec is the gate that matters most.
Contrast ratios in SP3 are asserted numerically, not eyeballed.

## Open items

- Whether `--pretable-line-height-cell` is worth adding. It is the prerequisite for making the
  wrapped-text estimator token-aware (`create-renderer.ts` hard-codes `ROW_LINE_HEIGHT = 24`, with a
  comment recording that mismatched constants previously blew a p95 gate), but it must ship as
  `normal` in Excel and Material so their computed values do not move. Deferred to SP3, decided
  there.
