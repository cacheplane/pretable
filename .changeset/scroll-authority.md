---
"@pretable/react": patch
---

Preserve row-layout scroll anchoring across controller rebuilds. Grid/DOM
viewport changes now enter the layout controller as explicit inputs, while
anchor-adjusted controller publications flow back through grid state to the
real scroll element without re-feeding the stale pre-anchor offset.
