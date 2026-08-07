---
"@pretable/core": patch
"@pretable/react": patch
---

Add `column.flex` — fill the container instead of guessing widths.

Every column was fixed: `widthPx`, or a fallback, or a one-off measurement from
`autosize`. Nothing sized to the container, so a grid either stopped short of
its right edge or ran past it, and the only recourse was hand-tuning `widthPx`
for one target width — which stops being right at any other window size.

`flex` gives a column a share of whatever the fixed columns leave over. Weights
are relative: two columns at `flex: 1` split the remainder evenly; `1` and `3`
split it a quarter to three quarters. `minWidthPx`/`maxWidthPx` still apply, and
a column carrying an explicit `widthPx` — including one a resize drag produced —
stops flexing, since an explicit width outranks a computed one.

Distribution is exact: the final flex column absorbs the rounding remainder, so
the row ends on the viewport edge rather than a pixel short. Grids with no flex
column render byte-for-byte as before, as does any grid whose viewport has not
been measured yet (SSR, and the first paint before the scrollport is read).
