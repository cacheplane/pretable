---
"@pretable/react": patch
---

Estimate wrapped row heights under the white-space model the browser is
actually running.

`pretable-surface.tsx` renders every wrapped cell with
`white-space: pre-wrap`, which preserves runs of whitespace and any whitespace
at the start of a line. Both of the row-height estimator's paths hardcoded
`text-core`'s `wrap` for exactly those columns — and `wrap` is
`white-space: normal`, which collapses a run to a single space and drops a
leading one entirely. So for any cell value containing consecutive spaces, a
tab, leading whitespace, or a newline followed by indentation, the estimator
predicted a wrapping that never happens: it planned the row one or more lines
short, and the row jumped when the measurement arrived.

The mode is now resolved from the DOM rather than hardcoded to `pre-wrap`, the
same way line height, padding and the render advance already are. The surface's
declaration is an inline style on the CELL, but the element that forms the line
boxes is frequently a descendant of it, and `white-space` is inherited — so a
rule on that descendant overrides the cell with no `!important` and no
specificity contest, and the used value is the only thing that can be trusted.
It is read once per theme change, off the `getComputedStyle` call the box
already makes, and only from a cell that declares itself wrapped: adopting the
`nowrap` of a non-wrapped cell would tell the estimator no wrapped column ever
takes a second line. A grid with nothing readable keeps the `wrap` it has
always assumed.

Tabs remain approximate. CSS advances a tab to the next `tab-size` stop, which
depends on where the pen already sits, while a canvas reports one flat advance
for `"\t"` — so a tab run is still under-charged, now by less.
