---
"@pretable/react": patch
---

A `flex` column now honours its `minWidthPx` and `maxWidthPx` even when the fixed columns already overflow the viewport, instead of falling back to the renderer's default width.
