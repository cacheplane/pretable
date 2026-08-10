---
"@pretable/react": patch
---

Give the header row the pixel it shares with the group panel. The panel and the
scroll viewport abut exactly, so the panel's bottom edge is the header's top
edge — and the panel's hit test claimed it. Dropping a dragged header on the
header's first row of pixels grouped by that column instead of reordering it.
The panel's rect is now half-open on its right and bottom edges.
