---
"@pretable/core": minor
---

Column visibility: `hidden` on column config, `setColumnVisible` on the grid
model.

`PretableGridUiColumn` and `PretableGridUiColumnLayout` gain an optional
`hidden` flag, and the grid model gains `setColumnVisible(columnId, visible)`.
A hidden column stays in the column model — its width, pin state, and relative
order are preserved — but is excluded from the drawn order the renderer and
span-resolving consumers see.
