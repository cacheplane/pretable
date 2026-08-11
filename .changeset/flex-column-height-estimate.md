---
"@pretable/react": patch
---

Estimate wrapped row heights at a `flex` column's resolved width.

A wrapped column's height estimate wrapped its text at `widthPx`, or at a fixed fallback when the
column declared none. That is not the width a `flex` column is drawn at — the drawn width comes from
distributing the leftover viewport space, and it moves with the viewport, with a sibling column's
resize, and with a column leaving the drawn set while grouped. So a column declaring both `wrap` and
`flex` had an estimate that never moved at all.

Measured in a browser with one `flex: 1` wrapped column beside a 140px fixed one, the estimate held
at 138px across drawn widths of 1058px, 558px and 318px — text that really occupied one, two and
three lines. It now tracks the drawn width, so rows that have not been measured yet are placed at a
height the viewport agrees with. The visible symptoms were scroll-anchor drift and a scrollbar sized
for content that was not there.

Only grids with a column declaring both `wrap` and `flex` are affected; every other column resolves
its width exactly as before.
