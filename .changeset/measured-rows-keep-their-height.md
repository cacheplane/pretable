---
"@pretable/react": patch
---

Stop re-estimating the height of a row that has already been measured.

When a streaming update replaced a row's data, the row layout controller published a fresh
`estimateDomRowHeight` value for it — even though the DOM had already reported that row's real
height. The estimate and the measurement disagree for any wrapped column, so every update swapped
one for the other and the rows below it jumped. On the homepage hero grid, which streams cell
updates into a wrapped column, this read as continuous jitter.

The controller now retains the last measured height per data-row identity and uses it as the
estimate gate's fallback, so an estimate is only ever used for a row that has never been measured.
Measured in Chrome against the hero grid, estimator-valued publications over a streaming run
dropped from 71 to 0.

Retention is bounded by a new `maxRetainedRowHeights` option and is scoped to data rows; group
entries are never retained, since the estimate gate that consumes retained heights is itself gated
on data rows.
