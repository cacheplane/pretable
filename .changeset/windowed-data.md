---
"@pretable/core": minor
"@pretable/react": minor
---

Windowed data: `resultMeta.window` positions a contiguous run of rows inside a larger population, and the grid keeps the scroll extent and `aria-rowindex` honest about where that window sits. Regions outside the window are pure geometry — no placeholder or skeleton rows are created, so nothing occupies an `aria-rowindex` belonging to a real record.

`PretableSurface` additionally receives a `windowGap` telemetry signal when the viewport passes an edge of the supplied window, so a consumer can fetch the next block without deriving "am I near the end" from a row range and a threshold.

The window's effects are gated on honesty: a row reports a dataset position, and the extent spans the dataset, only when the grid is also reporting the dataset count. Grouping, engine-applied filtering or sorting, and inexact totals all disable them together, so position, extent and count can never contradict each other.

This is the addressing layer. Eviction — releasing rows to bound memory while variable row heights stay stable — builds on it.
