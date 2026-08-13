---
"@pretable/react": patch
---

Measure the grid font's average character width instead of guessing 7px for every font.

The row-height estimator models a font as a single number — pixels per character — and wraps with `charsPerLine = floor(width / averageCharWidth)`. Nothing ever measured that number. `prepareText` inferred it by pattern-matching a font-key string, and the key the estimator passed was the literal `"Pretable Estimate 14"`, which matched none of its patterns. Every pretable grid, in every font, silently estimated at 7px per character.

React now measures the real value once per font with a single `canvas.measureText` call — no layout, no reflow, nothing inserted into the document — reading the computed font from an already-rendered cell and using that cell's own text as the sample. The result is threaded to the row-layout controller alongside `defaultRowHeight`. The estimator also learns a grid's real chrome and non-text floor from measurements it already takes.

Measured against 48 real rows captured in Chromium, mean absolute height error falls from 11.52px to 8.69px from the measured width, and to 6.85px with the learned terms applied.

Line-count prediction regresses in the same change: 43/48 correct at the guessed 7px, 37/48 at the measured 6.505px. The cause is a separate, untouched bug — `predictRowLineCount` wraps at the full column width and never deducts the cell's horizontal padding, over-stating characters per line. The old 7px guess over-stated character width by roughly the same factor, and the two errors cancelled. Measuring honestly removed one half of that accident and exposed the other; the padding bug is filed as a follow-up.

Where no canvas is available — server rendering, jsdom — the measurement returns `null` and estimates are byte-identical to before.
