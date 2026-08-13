---
"@pretable/react": patch
---

Row height estimates now account for two things the estimator could not see.

Line height is resolved from the element that actually lays the wrapped text
out, rather than from the cell. A cell that delegates its text to an inner span
takes that span's line height; a cell with no such descendant is unchanged.

A wrapped column's `render` output is measured, once per theme, and charged to
the wrapped text so the estimate accounts for the horizontal space it occupies.
This covers the shape where the wrapped text is a direct text node of the layout
element and the extras beside it are single-line element siblings — a trailing
chip, a leading icon. Anything else yields nothing and estimates exactly as
before.

Neither adds a per-estimate DOM read: both resolve through the existing
per-theme cache and its shared `MutationObserver`.
