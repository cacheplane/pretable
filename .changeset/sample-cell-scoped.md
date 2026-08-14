---
"@pretable/react": patch
---

Read the grid's font, letter spacing and sample text off the same cell the row
box is read off.

`resolveGridTextStyle` kept its own fallback lookup, an unscoped
`document.querySelector("[data-pretable-cell]")`. The row-select column is
synthetic and left-pinned, so its cell is the FIRST `[data-pretable-cell]` in
the document and that fallback always landed on it. It reports a normal cell
font, which is why it went unnoticed — but it lays out no text, only an 11px
checkbox button. So on any grid where no cell wraps, the "grid's own text" the
average character width was measured over was the built-in corpus string rather
than real content, and the font and letter spacing came off an element that
lays out nothing.

The lookup now comes from one shared `findSampleCell`, which prefers a wrapped
cell and excludes the row-select cell — the same exclusion the row box has had
since it started resolving line height from the element that lays out the text,
where sampling the row-select cell would have shipped an 11px line height for
every grid.
