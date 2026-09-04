---
"@pretable/ui": patch
---

The grid now answers two platform accessibility settings it was ignoring, and
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
