---
"@pretable/react": patch
---

Row height estimates now account for three things the estimator could not see.

Line height is resolved from the element that actually lays the wrapped text
out, rather than from the cell. A cell that delegates its text to an inner span
takes that span's line height; a cell with no such descendant is unchanged.

A wrapped column's `render` output is measured, once per theme, and charged to
the wrapped text so the estimate accounts for the horizontal space it occupies.
This covers the shape where the wrapped text is a direct text node of the layout
element and the extras beside it are single-line element siblings — a trailing
chip, a leading icon. Anything else yields nothing and estimates exactly as
before.

The line box that render output sits on is measured too. A row's height is
`(lines − 1) × lineHeight + lastLineBox`, not `lines × lineHeight`: a line box is
as tall as the tallest thing on it, and a trailing chip is taller than the text
it sits beside. The line box is measured off the same rendered cell as the width
— it is not the chip's own height, which the browser splits at the chip's
baseline — and an unmeasured one charges a plain line, exactly as before.

None of the three adds a per-estimate DOM read: all resolve through the existing
per-theme cache and its shared `MutationObserver`.
