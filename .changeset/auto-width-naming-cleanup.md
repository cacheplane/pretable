---
"@pretable/react": minor
"@pretable/core": minor
---

`autosizeColumns()` becomes `setAllColumnsAutoWidth(auto)`, and undeclared columns have one default width.

**The rename.** The grid handle's `autosizeColumns()` never sized anything to content — it put every column into the auto-width set, the mode bit that says "the grid manages this column's width". Nothing in the column-width path measures a cell. It is now `grid.setAllColumnsAutoWidth(auto: boolean)`, symmetric with the per-column `setColumnAutoWidth(columnId, auto)` that shipped alongside the tool panel, and it moves the roster in BOTH directions — `false` freezes every column at the engine's stored width, which the old name could not express. The surface's `autosize?: boolean | AutosizeOptions` prop is likewise `allColumnsAutoWidth?: boolean`, and the `AutosizeOptions` type is gone from both packages: it was a tuning bag (`averageCharWidth`, `cellPaddingPx`, min/max) for a measurement pass that does not exist, so every field was inert.

**One default width.** A column that declares no `widthPx` was drawn by the renderer at 140px but STORED by the engine at 160px, so turning auto width off on a never-resized column jumped its width 140 → 160 for no reason a user could see. Both numbers now come from one shared constant (140, and 220 for a `wrap: "text"` column) and the engine seeds its stored width through the renderer's own resolver, so the freeze lands on the pixel the column was already drawing. 140 won because it is what undeclared columns have always painted at — no grid repaints as a result of this change.

**A double-click that does something.** Double-clicking a column's resize handle was wired to a no-op. It now calls `setColumnAutoWidth(columnId, true)`, the pointer shortcut for handing that column's width back to the grid, which is what the docs had claimed all along.
