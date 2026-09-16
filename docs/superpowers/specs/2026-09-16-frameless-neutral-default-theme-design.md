# Frameless, neutral default theme — design

**Date:** 2026-09-16
**Status:** approved in conversation, pending written review
**Scope:** `packages/ui/themes/pretable.css`, `packages/ui/grid.css`, one surface attribute in `packages/react`, the theme tests, and the theming docs.

## Problem

Embedded in a host application, the default `pretable` theme reads as a widget dropped onto the page rather than part of it. Three things cause this, all deliberate in the current theme:

1. The scroll viewport draws a 1px `#7e7e8b` frame, a 10px radius, and a two-layer card shadow. Host UIs built on hairlines and whitespace have none of these.
2. The header rail is tinted `#eff0f4` and underlined with the same `#7e7e8b` line. Next to a host page whose section dividers are near-invisible, that underline is the darkest line on the screen.
3. Row hairlines at `#dfdfe5` and the selection tint at 10% blue are both a step heavier than the host's.

The screenshot that prompted this (an incoming-payments panel) shows all three at once: the grid is the only element on the page with a visible frame.

## Decision

Replace the default. `pretable.css` becomes frameless and neutral. There is no opt-in variant and no compatibility flag; pretable is pre-1.0 with no external consumers. Excel and Material skins are untouched.

The design principle is unchanged from the current theme's own comments: structure by tone and whitespace, colour only for interaction and state. What changes is that the container stops asserting itself and the header stops separating itself with a line it does not need until rows scroll under it.

## What changes

### Container

The scroll viewport and the group panel lose their frame entirely.

| Property | Now | After |
|---|---|---|
| viewport `border` | `1px solid var(--pretable-rule-strong)` | none |
| viewport `border-radius` | `var(--pretable-radius)` | none |
| viewport `box-shadow` | `var(--pretable-shadow-card)` | none |
| group panel `border` | `1px solid var(--pretable-rule-strong)`, no bottom | none |
| group panel `border-radius` | top corners `var(--pretable-radius)` | none |

Implementation choice: the `grid.css` rules stay and read tokens; the theme sets the tokens to nothing. Concretely `grid.css` keeps `border: var(--pretable-frame)` where the theme sets `--pretable-frame: 0`, `--pretable-radius: 0`, and `--pretable-shadow-card: none`. This keeps the existing `css-cascade` contract that the viewport reads the frame from a token, and lets Excel and Material keep drawing theirs by setting `--pretable-frame: 1px solid var(--pretable-rule-strong)`. The `[data-pretable-group-panel-wrapper] > [data-pretable-scroll-viewport]` corner rule becomes a no-op at radius 0 and is deleted.

`--pretable-rule-strong` is demoted to one job: the edge of lifted surfaces (menus, popovers, tooltip, the cell editor). Its comment block is rewritten to say so. Its value may lighten to `#c2c2cb` light and `#3a3a44` dark, since it no longer owes 3:1 against the header.

### Header

The rail stays a plane, but a quieter one, and its resting underline becomes the ordinary row hairline.

| Token | Now (light) | After (light) | Now (dark) | After (dark) |
|---|---|---|---|---|
| `--pretable-bg-header` | `#eff0f4` | `#f7f7f9` | `#1e1e24` | `#1a1a20` |
| `--pretable-bg-toolbar` | `#f1f1f4` | `#f7f7f9` | `#1e1e24` | `#1a1a20` |
| `--pretable-bg-group-row` | `#f7f7f9` | `#fafafb` | `#191920` | `#17171c` |
| `--pretable-text-header` | `#5e5e6a` | `#6b6b76` | `#9a9aa8` | `#8f8f9c` |
| header row `border-bottom` | `1px solid rule-strong` | `1px solid var(--pretable-rule-header)` | | |

`--pretable-rule-header` is a new token: `#e6e6eb` light, `#2a2a32` dark. It is one step darker than the row hairline so the rail still ends somewhere, and it is decorative, so it may sit under 3:1.

Header text must still clear 4.5:1 on the rail: `#6b6b76` on `#f7f7f9` is 5.0:1; `#8f8f9c` on `#1a1a20` is 5.9:1. The implementation re-measures and pins both.

### The scrolled seam

The 3:1 non-text contrast the old underline provided is a real requirement at scroll time: a sticky header with rows sliding under it needs an edge. The new theme meets it with elevation that appears only when it has a job.

- `packages/react` sets `data-pretable-scrolled` on the scroll viewport when `scrollTop > 0` and removes it at 0. The surface already owns the viewport's scroll handling (`pretable-surface.tsx`); the attribute is toggled there, coalesced with the existing scroll frame so it never adds a layout read.
- `grid.css` adds one rule: `[data-pretable-scroll-viewport][data-pretable-scrolled] [data-pretable-header-row] { box-shadow: var(--pretable-shadow-header) }`.
- New token `--pretable-shadow-header`: light `0 1px 2px rgba(16, 17, 26, 0.06), 0 6px 12px -8px rgba(16, 17, 26, 0.18)`; dark `0 1px 0 rgba(0, 0, 0, 0.6), 0 6px 12px -8px rgba(0, 0, 0, 0.7)`. Excel and Material set it to `none`; they keep their drawn underline.
- The header row already has a stacking context above rows (it is sticky); the shadow must paint over the first data row, which the implementation verifies with a screenshot test, not a selector match.

The attribute is a public DOM contract like `data-pretable-hydrated`, documented in the same place.

### Rows and selection

| Token | Now (light) | After (light) | Now (dark) | After (dark) |
|---|---|---|---|---|
| `--pretable-rule` | `#dfdfe5` | `#ececf0` | `#2c2c34` | `#25252c` |
| `--pretable-selection-bg` | `rgba(37,84,207,.10)` | `rgba(37,84,207,.07)` | `rgba(138,176,255,.16)` | `rgba(138,176,255,.12)` |
| `--pretable-checkbox-border` | `#787885` | `#94949f` | `#727281` | `#6a6a78` |

The checkbox border is an affordance, so it keeps a 3:1 floor. `#94949f` on white is 3.06:1, the lightest neutral that clears it; the mockup's `#9a9aa6` was 2.9:1 and is rejected. The contrast test pins the shipped value. Focus ring, checked checkbox, drop indicator, and the semantic ramp are unchanged.

`--pretable-rule-vertical` stays `transparent`. No zebra. Density tiers unchanged.

### Tokens removed

`--pretable-radius` on the container is no longer read by the house theme but the token stays, because Excel, Material, and custom themes use it and the control radius still derives from `--pretable-radius-control`. Nothing is removed from the public token list; two are added (`--pretable-rule-header`, `--pretable-shadow-header`) and one is added to `grid.css`'s consumption (`--pretable-frame`).

## What does not change

- Excel and Material themes. They set the three new tokens to their drawn-frame equivalents and are otherwise untouched.
- Cell padding, row heights, font sizes, icon size.
- The focus outline. The blue outline in the motivating screenshot is the focused cell and is correct.
- Column sizing. In that screenshot the columns stop short of the container's right edge. That is a sizing default, not theming, and is filed separately rather than folded in.

## Verification

- `packages/ui/src/__tests__/contract.test.ts` gains the two new tokens and re-pins every literal changed above, including the contrast ratios this spec quotes.
- `css-cascade.test.ts` assertions that currently demand `border: 1px solid var(--pretable-rule-strong)` on the viewport, group panel, and header row are rewritten to the new token reads. Each rewritten assertion is mutation-tested by deleting the rule it guards.
- A Playwright test scrolls a grid and asserts the header's computed `box-shadow` is non-`none` after scroll and `none` at rest, on the real component, per the prove-the-pixel rule.
- The theming docs (`token-reference.mdx`, `custom-themes.mdx`, `index.mdx`) are updated; the token table is guard-pinned, so the guard's fixture is updated in the same change.
- Website showcase and docs screenshots are re-taken. The hero grid and the `custom-theme` example are eyeballed in a browser in light and dark.

## Sequencing

One PR, five commits in this order so each is reviewable alone:

1. `grid.css`: introduce `--pretable-frame`, `--pretable-rule-header`, `--pretable-shadow-header` reads; Excel and Material set them to today's behaviour. No visual change yet.
2. `packages/react`: `data-pretable-scrolled` on the viewport, with a unit test.
3. `pretable.css`: retune every token in the tables above, rewrite the tier and line comments, update contract tests.
4. Playwright scrolled-seam test and docs.
5. Screenshot refresh.
