---
"@pretable/ui": patch
"@pretable/react": patch
---

The frozen-column seam is now one continuous edge instead of a shadow that
faded out at every row boundary.

It was a `box-shadow` on each pinned CELL, and a per-cell shadow cannot tile.
The blur has to stay inside the cell — a spread any less negative bleeds above
and below it and doubles into a dark band at each boundary — so the seam faded
to nothing once per row and read as a dashed edge rather than a frozen pane's.

grid.css now draws it as one full-height gradient per plane: the sticky header
row and the scroll content, meeting exactly at the header's lower edge. A
gradient has no falloff along its own axis, so each box is uniform for its
plane's whole height. The surface publishes where each edge falls
(`--pretable-pinned-left-edge` / `--pretable-pinned-right-edge`, gated by
`data-pretable-pinned-left` / `-right`), taking the right-hand one through the
same `getPinnedRightEdge` the right-pinned cells use so the seam cannot land a
pixel off the column it marks. `--pretable-seam-color` still colours it, and a
side with nothing pinned draws nothing.
