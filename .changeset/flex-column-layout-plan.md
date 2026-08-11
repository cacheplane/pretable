---
"@pretable/react": patch
---

Resolve `flex` columns at their drawn width when hit-testing a header drag and when scrolling a column into view.

`planColumnLayout` — the one plan shared by drag-to-reorder hit-testing and keyboard scroll-into-view — resolved every column through the renderer's `widthPx`-or-fallback rule. A `flex` column is not drawn at that width: it is drawn at its share of whatever the fixed columns leave over. Both consumers compare this plan against rendered pixels, so a flex column put every column after it at an offset nothing on screen had.

Measured in a browser with one `flex: 1` column between fixed ones in a 1000px scrollport, where the flex column is painted 518px wide:

- dragging a header and parking the cursor inside the next column painted the drop indicator 98px away from the boundary the cursor was over, and the drop landed the column at the far end of the grid instead of where the cursor pointed;
- with the flex column clamped by `minWidthPx` so the row overflowed, arrowing right to the last column did not scroll at all — the flex-blind plan's `totalWidth` was narrower than the viewport, so the reveal clamped its offset to 0 and the focused cell stayed off screen.

Both now match the painted geometry. Only grids with a `flex` column are affected; every other column resolves exactly as before, as does any grid whose scrollport has not been measured yet.
