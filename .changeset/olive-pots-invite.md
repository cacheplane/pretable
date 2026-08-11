---
"@pretable/react": patch
"@pretable/ui": patch
---

Replace the grid's glyphs with a first-party stroked icon set.

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
