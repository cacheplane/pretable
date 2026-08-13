---
"@pretable/react": patch
---

Wrap estimated row text by real measured segment widths instead of one average
character width. `@pretable-internal/text-core` gains an optional measurer,
grapheme-accurate counting, CSS `letter-spacing`, and a `white-space: pre-wrap`
mode; `@pretable/react` supplies a canvas-backed measurer cached by
`(segment, font)`. Against 48 rows captured from a real Chromium session, line
counts go 47/48 to 48/48 and mean height error 3.500px to 3.083px. Grids on a
host that cannot measure — server rendering, no canvas — estimate exactly as
before.
