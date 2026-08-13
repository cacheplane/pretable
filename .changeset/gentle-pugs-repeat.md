---
"@pretable/react": patch
---

Row height estimates now read the row box from CSS instead of inferring it.

`getThemeBoxMetrics()` resolves line height, cell padding and rule width off a
rendered cell and threads them to the estimator. Wrapped text is measured
against `columnWidth − 2 × paddingX` — the text box — rather than the full
column, which had been fitting more characters onto a line than a cell can
hold. Padding is per-theme and per-density (Excel 6/8/12px, Material 16px), so
on a 320px column this was worth up to 10% of the line.

The least-squares fit that had been learning "line height" and "chrome" from
measured rows is removed. It was inferring two numbers the browser reports
directly, and it had been absorbing the padding error rather than modelling
anything. The learned floor — what a custom `render` prop contributes, which
nothing else can observe — is kept.

Measured against 48 rows captured from a real Chromium session: line-count
prediction 37/48 → 47/48, mean height error 8.69px → 3.50px.

An unthemed grid is unchanged: the fallbacks compute to exactly the previous
constants.
