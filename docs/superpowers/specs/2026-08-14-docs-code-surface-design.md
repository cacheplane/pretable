# One code surface for the docs

**Date:** 2026-08-14
**Status:** Approved design
**Scope:** `apps/website` only.

## Problem

A fenced code block and an `<Example>`'s Code pane routinely sit within a screen
of each other — `getting-started` and `grid/grouping` both do — and they don't
match. Three concrete defects, all measured against the running site:

1. **Different type scales.** Fences rendered 13px/1.55, the Code pane 12.5px —
   two hardcoded values in two files. _(Fixed ahead of this spec in `462a5987`;
   both now read `--docs-code-size` / `--docs-code-leading`.)_
2. **Different chrome.** A fence floats its Copy button _over_ the code, and its
   header reserves a bar to show a bare language tag. **All 139 fenced blocks in
   the docs carry a language and none carry a filename** — `MdxRenderer` never
   passes one — so that bar is nearly empty on every page.
3. **Silent truncation.** The Code pane shows ~47% of a typical example and ends
   mid-statement with no indication more exists. Example sources run 48–252
   lines against roughly 27 visible.

A fourth, found while measuring: **focus markers are invisible on open.**
`custom-theme`'s `brand.css` is 192 lines with its first focused line at index
28, past the 27-line window. The feature that says "these are the lines that
matter" never shows them.

## Decisions

| Question             | Decision                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| Pane length          | Fixed height, but make truncation visible. Not expand-to-content.                  |
| Fence vs Code pane   | Converge on one shared code surface.                                               |
| Focus below the fold | Keep the pane dumb; fix authoring, enforced by a guard.                            |
| Header identity      | Title where practicable, falling back to the language tag. **Reversed** — see §1a. |
| Dim-contrast palette | **Out of scope.** Documented limitation, filed separately.                         |

## 1. One code surface

`CodeBlock` and the Example Code pane become one component: a header bar with
file identity on the left and actions on the right, then the code.

- A **fence** is that surface with one file, no Preview tab, no file tabs.
- An **example** is that surface plus a Preview tab and file tabs.

Copy moves into the header bar for both — it no longer floats over the code.

The header must show something worth its space. Since no fence carries a
filename today, either pass one through from the fence meta where authors supply
it, or drop the bar for untitled fences rather than rendering a lone language
tag. Decide during implementation and say which; do not keep a bar that shows
nothing.

## 1a. Identity in the header — the language-tag reversal

**Superseded:** "a lone language tag is nothing worth its space". Implementation
chose to render the identity side blank for an untitled fence, on that call.

**Reversed to:** show the `title=` where an author supplied one, and fall back
to the fence's language otherwise.

**Why.** The original call was conditional on authors titling _some_ fences.
None did: all 139 fences in the docs carried a language and **zero** carried a
title, so "blank when untitled" meant blank on every page — a 38px band with a
Copy button floated at its right and nothing else, measured in production. The
comparison the original decision made was "a language tag vs. a filename",
where the tag loses. The comparison it actually shipped was "a language tag vs.
an empty bar", where the tag wins: it is a small, true label, and the bar has to
exist anyway to hold Copy off the code. Titles are being added to fences
separately; the tag is what an untitled fence falls back to, not what it
settles for.

The tag is drawn as a quiet label — small, uppercase, letter-spaced, dim — not
in the filename's own type. It classifies; it does not name. A language that
names nothing (`text`, `plaintext`) still shows no tag: that would be the empty
bar with extra ink.

## 1b. Every row earns its space

A multi-file example stacked **three** bars between its title and its first line
of code: view tabs + actions, then the file tabs, then the surface's own header
— and that third bar reprinted the file name the file tab one row above was
already showing. Measured: 239px of chrome above the first line of code.

- The surface prints a filename only when nothing else is naming the file. The
  caller passes that intent down (`ExampleShell` withholds the path when it
  renders the tab strip); the surface never counts files itself.
- The line count and the expand control move up into the example's own toolbar,
  beside the view tabs. They were the only remaining contents of that third bar.
- With no identity and no actions left in it, the surface renders **no header
  at all** rather than an empty band. A fence always has Copy, so a fence always
  keeps its bar.

Result: 239px → 201px for a multi-file example, 51px → 51px for a fence (its one
bar now carries an identity instead of being blank). No affordance was dropped:
Copy, Copy for agent, `.md`, Expand and both tablists are all still present and
keyboard-reachable, with the roving tabindex on each tablist untouched.

## 2. Truncation you can see

Fixed height stays — it is what keeps toggling Preview/Code from shifting the
page, and that was the point of the layout.

Add, only when content actually overflows:

- A fade at the bottom edge of the pane.
- The line count, e.g. `192 lines`, so the shape is known before scrolling.
- An explicit expand control that grows the pane in place.

Both of the latter two live in the example's toolbar rather than in the code
surface's header — see §1b.

Expanding is a deliberate opt-in; the default height is unchanged.

## 3. Focus placement becomes a guard

The pane does not scroll to focus and does not collapse unfocused regions. The
convention is that a focus-marked file puts the marked lines near the top — and
an unchecked convention drifts, so it gets a test.

**Guard:** for every registered example, if a file declares focus markers, the
first focused line must fall within the visible window. Fail with the example
id, the file, the line number, and the window size.

`custom-theme`'s `brand.css` fails this today. Fixing it means reordering the
file so the walked-through tokens come before the 20-line explanatory header —
which is better authoring regardless of viewport.

The window size must be derived from the same type scale the pane renders at
(`--docs-code-size` × `--docs-code-leading` against the pane height), not
hardcoded, or the guard drifts from the thing it guards.

## Out of scope

**The dim-contrast palette.** `globals.css` already documents that unfocused
lines at `opacity: 0.65` put the dominant token at 4.61:1 but leave keyword red
at 2.63:1 and identifier blue at 3.05:1, and that the only real fix is a
purpose-built low-saturation focus palette. That remains true and remains
unfixed. Do not change the opacity value as a partial measure — it was chosen
deliberately and its reasoning is recorded in the stylesheet.

Line numbers were considered and are not in scope.
