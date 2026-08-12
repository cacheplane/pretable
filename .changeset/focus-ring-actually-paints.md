---
"@pretable/react": patch
---

Fix the cell focus ring, which was declared but never painted. Every gridcell rendered with an inline `outline: none` — added years earlier alongside keyboard navigation, when the ring was drawn as an inset `box-shadow` and the user-agent outline needed suppressing. Once the ring became an `outline`, that inline declaration silently erased it: an inline style beats a `@layer` + `:where()` rule at any specificity. `outline-offset` kept applying, so the rule still looked live while nothing was drawn, and a focused cell showed no focus indicator in any consuming app.
