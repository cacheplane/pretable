---
"@pretable/ui": patch
---

The frozen-column seam now runs through the header row instead of starting
below it.

`--pretable-seam-color` was drawn by `[data-pretable-cell][data-pretable-pinned]`
only. The pinned HEADER cells took the opaque `--pretable-bg-header` fill and
nothing else, so the shadow that marks the frozen edge stopped dead at the
header — a header-tall gap at the top of a boundary that is meant to run the
height of the grid, visible on any grid with a pinned column and a horizontal
scroll. The header's pinned rule is now split per side, each carrying the
mirrored offset its body counterpart has.

The guard that should have caught this named `[data-pretable-cell]` alone; it
now covers the header rules too, on both sides, and checks that the seam did
not cost the opaque fill.
