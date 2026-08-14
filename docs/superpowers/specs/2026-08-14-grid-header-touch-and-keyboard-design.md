# The grid header on touch and keyboard

Date: 2026-08-14
Status: approved

## Problem

Four defects filed separately share one cause: the column-header controls were
designed around three mouse assumptions that all fail together on a phone —
they are small (18px), hover-revealed, and packed overlapping into a 40px slot
hugging each column's trailing edge. A fifth defect, keyboard reachability, is
the same cluster of controls under a different input modality.

Fixing them one at a time produces three separate compromises inside the same
40px, which is why they are one project.

### Measured facts

Every number below was measured, not estimated. Touch figures are real iPhone
13 emulation (390x844, `pointer: coarse`) against production.

| Fact | Value | Where |
|---|---|---|
| Grid viewport on a phone | **324px**, ~2 columns visible | `/docs/grid/grouping` |
| Column widths there | 220, 140, 140, 140, 140 | same |
| Header height | **51px** | same |
| Funnel computed opacity on touch | **`0`** | `pointer: coarse` true, `hover: hover` false |
| Resize strip | 4px, `left: -4` | `pretable-surface.tsx` |
| Filter funnel | 18px, `left: -22` | same |
| Column menu | 18px, `left: -40` (or `-22`) | same |
| Tab stops, 5-column grid, Chromium | **10** (Sort+Filter per column) | measured |
| Tab stops, same grid, WebKit | **0** | measured |

Vertical space is not the constraint — 51px comfortably holds a 44px target.
**Horizontal is.** Three WCAG 2.5.8-compliant targets need 72px, which is 51%
of a 140px column, covering the label they sit beside.

### The control set is smaller than it looks

- `showResizeHandle` = `column.resizable !== false` — **default on**
- `showFilterFunnel` = `column.filterable !== false` — **default on**
- `showColumnMenu` = `groupPanelEnabled && !groupColumn && !rowSelectColumn`

So the common grid has **two** controls (22px), and the three-control case is
grouping-only. This is materially more tractable than the 72px figure suggests.

## Scope

**In:** the touch and keyboard behaviour of the header's resize strip, filter
funnel and column menu, in `@pretable/react`, `@pretable/grid-core` and
`@pretable/ui`.

**Out:** the docs-site `Tabs`/`CodeGroup` roving tabindex, and the `as never`
casts in the controlled write-back. Both are real, both are unrelated to the
grid, and each gets its own small spec.

**This repo is pre-1.0 with no external consumers. Breaking changes are
preferred over compatibility shims. No deprecation aliases.**

## Part A — touch

### A1. Drop the resize strip on coarse pointers

A 4px strip is not usable with a finger at any size, and finger-dragging a
column edge on a 324px viewport is a poor interaction even with a large target.
Rendering nothing when `pointer: coarse` removes a WCAG 2.5.8 failure **by
removing the control**, and frees the trailing edge that squeezes the funnel.

Resizing stays a pointer affordance. If touch resizing is ever wanted it
belongs in a menu, not in an invisible strip.

### A2. The funnel is always visible on coarse pointers

There is no hover on a phone, so a hover-revealed control is simply invisible —
today the funnel computes `opacity: 0` on every phone, which is why the 24px
target it just gained is a target nobody can see. On `pointer: coarse` it
renders at full opacity regardless of filter state.

This changes how every grid looks on a phone. That is the intended change.

### A3. Targets of at least 24px, without changing the glyph

The funnel already has a transparent `::after` hit area (24x24, `right: 0`).
The column menu gets the same treatment. The glyph stays 18px: the button is
the box the hover chip and focus ring paint on, so growing it would put a 24px
chip around an 18px icon.

**The header box must not change size at any density.** `getDensityHeights`
reads header and row height in JavaScript for virtualization geometry; a CSS
change that grew the header would desynchronise painted layout from measured
layout. Out-of-flow pseudo-elements guarantee this.

### A4. Slot offsets move to custom properties

**This is the architectural blocker.** The offsets are *inline styles*
(`left: -22`, `left: -40`), and inline style beats every stylesheet rule,
`!important` and `@layer` included. No media query can re-space them.

The inline style instead reads a token — `left: "var(--pt-header-funnel-slot)"` —
and CSS redefines the tokens under `@media (pointer: coarse)`. The anchor maths
stays in JS; the geometry becomes themeable rather than hardcoded.

Coarse layout, with no resize strip: funnel at `-24`, column menu at `-48`.
Two 24px targets in 48px, which fits a 140px column at 34%.

## Part B — keyboard

### B1. The header joins the roving-tabindex model

Data cells already rove (`tabIndex={cellIsFocused ? 0 : -1}`); the header never
joined, and the two engines expose that differently — Chromium makes every
header button a tab stop (10 on a 5-column grid, 40 on a 20-column one), WebKit
makes none of them one. Neither is correct.

This is a **leak**, not a missing feature. `PretableIndexedFocusMovement`
already carries `tab` and `shift-tab`, so the grid intercepts Tab in the body
and moves its own cursor. The header is the one place the browser's native tab
order still shows through, because those buttons are ordinary focusable
elements that never joined the model.

After this, the grid is **one tab stop**. Header controls become
`tabIndex={-1}` and are reached with the focus cursor.

**This is a breaking change for keyboard users on Chromium**, taken
deliberately: 40 tab stops to pass a wide grid is not a usable alternative, and
the current Safari behaviour is 0.

### B2. Header focus needs a new ref variant, not a null row

The obvious encoding — `{ref: null, columnId}` — **does not work**, and this was
verified before committing to it. `indexed-focus.ts:57` (and three sibling call
sites) normalize `ref === null || columnId === null` to `emptyFocus()`, so a
null ref with a real column collapses to "no focus" on the first round trip.

Instead, widen `PretableVisibleRowRef` with a `{kind: "header"}` variant. A
focus cursor addresses a *cell*, and a header cell is a cell. This is a
breaking change to an `@public` type, and it is the right one: every existing
`indexOf` / `nearestVisibleRef` / `snapshot` call site is then forced by the
compiler to say what it does with a header ref, rather than silently treating
it as a data row.

The plan must enumerate those call sites; a `default:` branch that swallows the
new variant would defeat the point.

### B3. Movement and activation

- ArrowUp from the top data row moves to the header of the focused column.
- ArrowDown from the header returns to the first data row.
- Left/Right on the header move between columns.
- Enter/Space on a focused header sorts, as the header button does today.
- A documented key opens the filter popover for the focused column; another
  opens the column menu. The plan chooses the bindings and must check them
  against what `keyboard.mdx` already promises.

`PretableIndexedFocusMovement` already has `up`/`down`/`home`/`end`, so this
extends existing movements rather than inventing a vocabulary.

## Part C — verification

A passing unit test proves very little here. jsdom models neither Safari's
tab-order policy nor pseudo-element geometry (`getComputedStyle` with
pseudo-elements is explicitly `Not implemented`), and it lays nothing out.

**The assertion that would have caught all of this:**

> a 5-column grid is exactly **one** tab stop, not ten.

Required evidence:

1. **Tab-stop count** in Chromium *and* WebKit, asserted as a number.
2. **Hit-test sweep** — `elementFromPoint` at 1px steps around each control,
   which measures the real target including the pseudo-element. Run at all
   three densities, coarse and fine.
3. **Header/row height unchanged** at all three densities, compared on/off in
   the same layout frame rather than across builds.
4. **Keyboard journey**: Tab into the grid, ArrowUp to the header, sort, open
   the filter, Escape back, ArrowDown to the data — in both engines.
5. **A control removed is not a control broken**: with the resize strip gone on
   coarse pointers, resizing must still work under `pointer: fine`.
6. Every new assertion **watched failing** via a deliberate mutation.

### One thing the plan must settle first

In the measured Chromium trace, Tab went from the last header control **straight
out of the grid** — no data cell was ever a stop. If no cell holds
`tabIndex={0}` until one is clicked, the grid body may be unreachable by
keyboard from a cold start. That is a separate and more serious defect than the
one this spec is about. **Confirm or refute it before building on the focus
model**, and if it is real, say so rather than folding a silent fix into this
work.

## Risks

- **`keyboard.mdx` documents `Tab` as a binding** and mentions the header only
  as scroll-occlusion chrome — it never promises header navigation today. So
  the page gains a section rather than contradicting itself, but the `Tab`
  entry must be re-checked against the new model. A stale sentence there is a
  correctness bug, not a docs chore.
- **The column menu has exactly one item** (group/ungroup) and its own comment
  notes there is no arrow-key roving "for that reason". If the plan routes more
  actions into it, roving becomes mandatory.
- **`{kind: "header"}` widens a public union**, so the API report and the docs
  tables pinned to it will both move.
- Making the funnel always visible on touch is a **visual change to every
  grid on a phone**, not a bug fix.
