---
"@pretable/react": patch
---

Stop recomputing the estimator's line count on every measurement. The row
layout controller asks `predictRowLineCount` to classify each measured data row
for the height calibration, and the estimator had already computed that number
for the same row from the same inputs — so the calibration path re-prepared and
re-laid out every wrapped cell in the grid once per commit. The count is now
stored on the estimate's existing cache entry and read back. Measured on the S2
`hypothesis` scroll benchmark, time under `predictRowLineCount` falls from
17.3ms (3.27% of the run) to 1.1ms (0.22%). No estimate, line count or rendered
row count changes.
