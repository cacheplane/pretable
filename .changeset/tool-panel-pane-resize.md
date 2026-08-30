---
"@pretable/react": minor
---

The tool panel's pane is resizable, and the columns section can hand a column's width back to the grid.

The pane's grid-side edge is now a drag handle with full keyboard parity: a focusable `role="separator"` with live `aria-value*`, arrow keys stepping 16px (direction-aware in RTL), `Home`/`End` to the bounds, and `Enter` or double-click resetting to the default. Width is React chrome state with the surface's controlled/uncontrolled trio — `defaultPaneWidthPx` / `paneWidthPx` / `onPaneWidthChange` on `PretableToolPanelConfig` — clamped everywhere and reported already-clamped. An untouched, uncontrolled pane writes no inline style, so an existing stylesheet override of the pane's width keeps working until someone actually resizes.

The columns section's row menu gains an "Auto width" toggle (`role="menuitemcheckbox"`, the new `toolPanelAutoWidthLabel` message), and the handle gains `setColumnAutoWidth(columnId, auto)`. Auto width is a mode bit, not a content fit: on, the grid manages the column's width (the renderer's default, or a flex share when the column declares `flex`); sizing the column yourself turns it off; the toggle hands the width back. The resize handle's accessible name is the new `toolPanelResizeLabel` message.
