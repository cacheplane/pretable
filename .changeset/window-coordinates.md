---
"@pretable/react": minor
---

Windowed grids at a nonzero dataset offset are on screen again.

A grid serving `resultMeta.window.start = 5000` rendered **blank** and reported
**zero visible rows** in telemetry. Its 50 loaded rows were drawn at
`top: 240000px` — correct, for a 10,000-row extent — while the layout
controller clamped its own `scrollTop` to the _loaded_ rows' ~2,000px height
against a ~480,000px content div. No scroll position lined the two up. At
`window.start = 0` the two coordinate systems coincide, which is why this shipped.

**The fix: the row-layout controller now publishes one coordinate system.**
`state.scrollTop` and `state.viewport.scrollTop` are GLOBAL — measured from the
top of the whole dataset, leading spacer included — the same space every
published row `top`, `state.totalHeight` and the DOM scroller's own `scrollTop`
already lived in. Consumers compare those values against each other constantly,
and a snapshot that mixed the two was not something a caller could use correctly.

Also fixed, from the same cause: `grid.scrollToRow()` and keyboard
scroll-into-view both fed a loaded-window-LOCAL row offset straight to the
scroller, so on a windowed grid they jumped to the top of the dataset instead of
to the row.

**Contract change for direct consumers of the internal renderer.**
`PretableIndexedRenderSnapshot` gains `leadingHeight` — the distance between the
loaded window's local origin (which `rowMetrics` still uses, because a
`RowHeightIndex` only knows loaded rows) and the global one everything else uses.
It is `0` on every non-windowed grid.

Nothing in the public `@pretable/react` telemetry surface changes meaning:
`onTelemetryChange` computes `visibleRowCount` / `visibleRowRange` from the
scroller's own offset, which was always global. Those numbers were simply wrong
for a windowed grid and are now right. Shipped as **minor** rather than patch
because `PretableIndexedRenderSnapshot` grew a required field, not because
telemetry's meaning moved.

**Known gaps, deliberately not closed here.** `windowGap` telemetry still
re-derives the spacer as `leadingRows * getThemeRowHeight()` rather than reading
the published `leadingHeight`; same number today, but read at a different moment,
so a density change between plan and render would desynchronize it. Nothing
exercises the window's bottom edge or the trailing spacer.
