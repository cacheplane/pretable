# Teach the row-height estimator what a row actually costs

**Date:** 2026-08-13
**Status:** implemented, **failed its own gate**, superseded in part. See "Gate outcome" below.
**Superseded by:** `2026-08-13-estimator-character-width-design.md`, which attacks the term this
design named as a residual and which turned out to be most of the error.
**Follows:** `2026-08-12-row-height-estimate-stomping-design.md` (shipped as #342). That
change stopped estimates from overwriting measurements. This one makes the estimates
themselves correct, which is what the earlier design listed as its two known follow-ups.

## Problem

`estimateDomRowHeight` (`packages/renderer-dom/src/create-renderer.ts`) predicts a row's
height before that row has ever been rendered. The virtualizer needs it for scroll extent
and row offsets; it is also what a row is drawn at for the first frame it enters the
window. It is wrong in three ways that compound.

**Its metrics are hardcoded to another app's font.** `ROW_LINE_HEIGHT = 24`,
`ROW_CHROME_HEIGHT = 42` and `ESTIMATED_CHARACTER_WIDTH = 7` are, per the comment above
them, "calibrated against actual browser metrics for Inter Variable at 16px in the bench
app". The homepage hero measures a real line height of ~21.07px and real chrome of 25px
(24px cell padding + 1px row border). Both constants overshoot, in the same direction.

**It is blind to everything the presentation layer does.** The loop walks only columns with
`wrap: true` and reads `readCellValue(row, column)` — the raw value. So `render` is
invisible, and `format` is invisible. In the hero, on rows whose analyst text is still
empty, the tallest cell is `dayPnl` — a custom two-line renderer (a signed delta with its
percentage stacked beneath) measuring 37.5px. The estimator has never heard of it.

**Consequently its floor is wrong.** The estimator's minimum for any wrapped column is one
line plus chrome, `1×24 + 42 = 66`, against a measured 63 and a theme row-height floor of 48. A row entering the window for the first time visibly jumps 66 → 63.

The escape hatch already exists — `estimateRowHeight` is an injectable option
(`packages/renderer-dom/src/types.ts`) — so this is not about capability. It is about what
the default does for the consumers who will never write their own, which is most of them.

## The measurement instrument already exists

`row_height_error_p95_px` (`apps/bench/src/bench-runtime.ts`) and
`post_interaction_row_height_error_p95_px` are existing bench metrics, and the constants
above carry a note that mismatching them "caused H1's `row_height_error_p95_px` to fail at
5px". So estimator accuracy is already instrumented and was already budgeted. This project
has a number to move rather than an argument to win, and that number is the arbiter.

## Model

The hero's measured heights are 63 at L=1, 68 at L=2, 89 at L=3, where L is the predicted
line count of the widest wrapped column. Those are not collinear: 68−63 = 5, 89−68 = 21.
They fit a hinge exactly:

```
measured ≈ max( floor , chrome + L × lineHeight )
```

With `chrome = 25` and `lineHeight = 21.07`: L=2 → 67.1 → **68**, L=3 → 88.2 → **89**. L=1
would give 46.1, but the row measures **63**, because at one line the analyst cell is not
the tallest cell in the row — `dayPnl` is.

The hinge is not a modelling convenience. `floor` is exactly the non-text content the
estimator cannot see, and `chrome`/`lineHeight` are exactly the mis-calibrated constants.
One fit addresses both known follow-ups.

**The hinge must be a real branch, not a max.** Implementation found that taking an
unconditional `max(floor, chrome + L × lineHeight)` is correct only once _all three_ terms
are learned. `floor` is learned from the first short row; the slope fit needs several
wrapped samples. In the interval between — the common case, not an edge case — the floor is
measured truth while the line metrics are still the bench constants, and
`max(63, 1×24 + 42)` is **66**: exactly the first-paint shrink this design exists to remove.
So a row of ≤1 predicted line is answered by the learned floor when one exists, and by the
text term otherwise. This cannot under-estimate: the floor is learned from precisely the
≤1-line population, whose measured heights already include what one line of text costs, so
it dominates that case by construction.

## Design

**Learn the parameters from measurements the grid already takes.** Every
`controller.measure(ref, height)` is a labelled sample: compute L for that row through the
existing memoized `text-core` path, then

- **L ≥ 2** — wrapped text provably dominates — feeds a least-squares regression of
  `measured` on `L`. The slope is `lineHeight`; the intercept is `chrome`. This is
  identifiable only once samples exist at **two or more distinct L values ≥ 2**; until
  then the parameters stay unlearned.
- **L ≤ 1** feeds the `floor` accumulator separately, because those rows' heights are set
  by their tallest non-wrap cell, not by text.

Data rows only, consistent with the retention shipped in #342 — group rows have different
chrome and would poison the fit.

**Placement.** A pure module in `renderer-dom` exposing `observe(lineCount,
measuredHeight)` and `getParameters(): { lineHeightPx, chromePx, floorPx } | null`. No DOM
access, no SSR hazard, unit-testable without a browser. This preserves the estimator's
current character as pure arithmetic, which is the property that ruled out an offscreen
probe element.

`estimateDomRowHeight` takes the learned parameters as optional inputs and passes them to
`layoutPreparedText`, which already accepts `lineHeightPx` and `paddingBlockPx`. No new
plumbing in `text-core`.

**Lifetime.** Calibration state is keyed on `(columns identity, defaultRowHeight)` — the
same keys the existing estimate memo uses — and resets when either changes, so a density or
theme flip re-learns rather than carrying another theme's metrics.

## Guards

- `getParameters()` returns `null` until the sample threshold is met, and an unlearned
  estimator must behave **exactly** as it does today. This is the property that makes the
  change safe to ship: with no samples, nothing moves.
- Learned values are clamped to sane ranges. A degenerate fit falls back to the constants
  rather than propagating.
- Samples live in a bounded ring buffer, so a grid whose content class changes re-converges
  instead of averaging over its entire history.
- The existing `Math.max(defaultRowHeight, …)` clamp in the controller stays.

## Deliberately not learned

`averageCharWidth`. It determines L itself, and separating it from the other parameters
needs observations of where wrap points actually fall — which a height measurement does not
provide. It stays at 7. Residual error therefore remains wherever the predicted line count
is simply wrong, and the regression will absorb some of it as bias. This is named as a
known residual rather than modelled speculatively; `row_height_error_p95_px` decides
whether it matters enough to revisit.

## Verification

The gate discipline from the previous two rounds applies: the measurement comes first and
can stop the project.

1. **Baseline.** Record `row_height_error_p95_px` and
   `post_interaction_row_height_error_p95_px` across the bench scenarios on current `main`.
   **No implementation begins until this number exists.**
2. **Unit tests on the pure calibration module.** Known samples in, known parameters out;
   the unlearned case returns `null`; a degenerate fit falls back. Each assertion
   mutation-checked — a test that passes with the logic removed proves nothing.
3. **Re-run the bench and compare.** If p95 error does not drop, the design is wrong and we
   stop rather than shipping a more complicated estimator that is no more accurate.
4. **Symptom check, not criterion.** The hero's first-paint 66 → 63 jump should close as a
   consequence. It is confirmation, not the goal.

## Gate outcome — the design did not deliver

Verification step 3 ran against 23 real hero rows captured in Chromium
(`packages/renderer-dom/src/__tests__/row-height-accuracy.fixture.ts`) and returned:

```
mean |estimate - measured|: 13 -> 13
```

Uncalibrated 13.0px, calibrated 13.0px. Three structural reasons, all found by diagnostic
rather than argument:

1. **The slope fit never became identifiable.** Every wrapped sample in the training half
   had a predicted line count of exactly 3, so the `denominator === 0` guard correctly
   declined to fit and `lineHeightPx` / `chromePx` stayed `null`. This is not a module
   defect — it is what unidentifiable data looks like, and it is likely the common case for
   a wrapped column whose content is bimodal.
2. **The floor being a running max nets to zero on this population.** Learned
   `floorPx = 68` corrected five measured-68 rows by 10px in total and worsened five
   measured-63 rows by the same 10px.
3. **The dominant error is the term this design explicitly declined to learn.** 250px of
   the 299px total error is ten rows where the estimator predicts 3 lines and emits 114px
   against a browser-produced 89px (2 lines). That is `ESTIMATED_CHARACTER_WIDTH = 7` being
   wrong for the font. "Known residual" was the wrong call: it is most of the error, and
   nothing in this design can reach it.

A counterfactual was found and deliberately not taken: fitting across all 23 samples scores
a mean error of 2.30px, but only by learning `lineHeightPx = 7.0` — not a font metric, just
a degenerate slope absorbing the line-count error, and it clears the plausibility bound. It
would score well and mispredict the moment content shape changed.

**What survives.** The calibration module and its wiring are retained, because `chrome` and
`floor` are real terms worth roughly 50px that nothing else measures — but they can only pay
off once the predicted line count is correct. The accuracy fixture and instrument are
retained as the gate for the successor design.

## Out of scope

- Group-row estimation. The estimate gate is data-only, so group rows are untouched here;
  whether they should be is a separate product call.
- The false comment at `packages/react/src/pretable-model.ts:405`, which claims
  `defaultRowHeight` and the surface's measured-row floor "agree under every theme". They
  do not for wrapped rows. Worth fixing, but it is a documentation defect, not part of this
  mechanism — and this change may make the claim true, at which point the comment should be
  rewritten rather than deleted.
