# Measure how wide the font actually is

**Date:** 2026-08-13
**Status:** design approved, not yet implemented
**Supersedes in part:** `2026-08-13-row-height-estimator-calibration-design.md`, which failed
its gate because it declined to learn the term that turned out to dominate.

## Problem

`estimateDomRowHeight` predicts a row's height before the row is rendered. Its text term goes
through `@pretable-internal/text-core`, whose entire model of a font is **one number**:

```
charsPerLine = floor(width / averageCharWidth)
```

That number is not measured. `prepareText` resolves it by *sniffing the font-key string* —
`includes("mono")` → 8, `"condensed"` → 6.5, `"serif"` → 7.25, else 7
(`packages/text-core/src/prepare-text.ts`). The key `create-renderer.ts` actually passes is
the literal `"Pretable Estimate 14"`, which matches none of those patterns, so every grid
silently gets 7px per character regardless of its font.

Measured consequence, from 23 real hero rows captured in Chromium: ten rows of 87-character
commentary at 320px are predicted at 3 lines / 114px against a browser-produced 2 lines /
89px. That single error accounts for **250px of the 299px total**. The preceding calibration
design named this a "known residual" and could not reach it; that judgement was wrong.

An average nearer 6px predicts 2 lines for the same content.

## Decision: measure it, do not import it

`@chenglou/pretext` (MIT, zero dependencies) solves this problem thoroughly — real glyph
widths via canvas, plus bidi, grapheme segmentation, emoji, CJK, letter-spacing, and a
per-browser accuracy corpus. It was evaluated and **declined**: taking a pre-1.0,
single-maintainer dependency into a published package is a cost we are not paying for a term
we can measure ourselves in one call. Its cost model is also inverted relative to ours — it
optimises "prepare once, re-layout on resize", while an estimator's whole job is cheap
guesses for rows that have never rendered.

This design keeps `text-core` exactly as it is — pure, DOM-free, one number per font — and
replaces the guessed number with a measured one.

## Design

**Measure once per font, with canvas, in the React layer.**

`packages/react` already resolves theme-dependent numbers and hands them to the controller —
`defaultRowHeight: getThemeRowHeight()` (`pretable-model.ts`). Character width joins it by
the same route, which keeps DOM reads in the package that owns the nodes.

- Read the grid's computed `font` shorthand from a rendered cell.
- Measure a representative sample with `ctx.measureText(...).width / graphemeCount`, using
  `OffscreenCanvas` where available and a detached `<canvas>` otherwise. No layout, no
  reflow, no element inserted into the document.
- Cache per resolved font string, so the cost is one `measureText` per font per session.
- Thread the result to the controller as an option, into `estimateDomRowHeight`, into
  `prepareText({ averageCharWidth })`.

**Where the sample text comes from.** Prefer real content — the text of an already-rendered
wrapped cell — over a synthetic alphabet, because average character width is content-
dependent and a corpus string bakes in English-prose bias. Fall back to a fixed sample when
no wrapped cell has rendered yet.

**No canvas, no change.** Without `OffscreenCanvas` and without `document` — server
rendering, jsdom — the measurement returns nothing and `prepareText` keeps its existing
guess. As with the calibration work, an unmeasured grid must behave byte-identically to
today.

## What this does not do

It does not make wrapping correct for content whose character mix is unusual — all-caps,
digit-heavy, CJK, emoji. A uniform average is still a uniform average, and those cases stay
wrong. That is the accepted cost of declining the dependency, and it should be stated in the
estimator's own commentary rather than discovered later.

## Relationship to the calibration work

Complementary, not competing. This design fixes the **text** term (250px of the observed
error). The retained calibration module learns `chrome` and the non-text `floor` (~50px) —
the custom-renderer contribution the estimator is structurally blind to. Neither reaches the
other's term.

The calibration's slope fit should also become identifiable once line counts are correct:
its failure mode was every training sample landing on the same predicted line count, which a
correct character width breaks up.

## Verification

The instrument already exists and already fails, which is the ideal starting point.

1. **Baseline is recorded:** `mean |estimate − measured| = 13.0px` across
   `row-height-accuracy.fixture.ts`, with the test currently red.
2. **Gate:** the same test must go green — calibrated error materially below uncalibrated.
   Report both numbers. Do not adjust the fixture or the assertion to reach it.
3. **Line-count check:** assert directly that the ten 87-character samples predict 2 lines
   rather than 3. Height error alone can improve for the wrong reasons; the line count is the
   thing this design claims to fix.
4. **Safety property:** with no measured width, estimates must be byte-identical to today.
   The two pre-existing estimator tests pin this and must pass unedited.
5. **Bench no-regression:** `row_height_error_p95_px` must not rise from the recorded
   baseline (runset `2026-08-13t04-27-03-476z`: S1 scroll 1, S2 scroll 4, S3 scroll 1,
   S7 scroll 4).

## Out of scope

- Per-string measurement or a pluggable measurer inside `text-core`. That is the shape the
  declined dependency already implements well; if a uniform average proves insufficient,
  revisiting the dependency decision is more honest than growing our own.
- `layoutPreparedText`'s wrapping algorithm, which is token-aware and not the problem.
