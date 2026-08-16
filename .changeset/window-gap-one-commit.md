---
"@pretable/react": patch
---

`telemetry.windowGap` now judges the viewport against geometry from a single
commit, which fixes a false negative and a false positive that had the same
cause.

**The boundary is the plan's, not arithmetic over it.** The end of the loaded
window was reconstructed as `totalHeight - trailingRows * rowHeight`: a pixel
total published by the last row layout plan, minus a row count derived fresh
from `resultMeta` every render. The row layout controller does not replan on a
`resultMeta`-only change, so those two halves could describe different states of
the world. A `total` that GREW pushed the boundary further away and hid the
defect; a `total` that SHRANK moved it the other way, and `windowGap` went
silently absent for a viewport still genuinely past the loaded rows — until any
scroll or row change triggered a replan. The plan already publishes both honest
halves of that boundary (`leadingHeight` and the loaded rows' own height), so
the judgement now reads them directly and reconstructs nothing. When the plan is
current the two expressions are the same number by construction, so no answer
that was already correct has changed.

**No gap is reported while the layout does not describe the rows.** At mount
there is no geometry — the boundary sits at pixel 0 — so every viewport, on a
grid nobody had scrolled, read as past its own window. That covers three states
that all publish `totalHeight: 0`: before the first plan, a first block of rows
landing against the plan for an empty grid, and the render where `rows` have
been handed over but the row model has not ingested them yet. A gap is now
reported only once the plan, the row model and the rows you supplied agree on
how many records are loaded. On the windowing docs example, mount went from four
requests to one — the example's own.

Absence of a gap has always meant "no signal" rather than "the viewport is
inside the window", and that is unchanged: a handler that can tell from its own
state that the reader is past the loaded block should still act on what it
knows.
