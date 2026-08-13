# Read the box, measure the text, learn only the unobservable

**Date:** 2026-08-13
**Status:** design approved, not yet implemented
**Follows:** `2026-08-13-estimator-character-width-design.md` (shipped as #358) and
`2026-08-13-row-height-estimator-calibration-design.md` (implemented, failed its own gate,
partly retained).

## Problem

Three mechanisms now predict one number — a row's height before it renders — and two of them
infer values the browser will state outright:

- hardcoded constants (`ROW_LINE_HEIGHT = 24`, `ROW_CHROME_HEIGHT = 42`,
  `ESTIMATED_CHARACTER_WIDTH = 7`)
- a least-squares fit learning line height and chrome from measurements
- a canvas-measured average character width

Every defect this series hit came from that overlap:

- The fit is **unidentifiable** whenever sampled rows share a line count, which is common.
- Its degenerate solution scored a 2.30px mean error by learning a "line height" of 7.0px —
  not a font metric, just a slope absorbing line-count error.
- The 7px character guess over-stated character width by roughly the factor by which the
  wrap width over-stated the text box (it never deducts cell padding). **Two errors
  cancelled**, and correcting one exposed the other as a regression: line-count accuracy went
  from 43/48 at the guess to 37/48 at the measured width.
- The hinge in the height model needs a special case purely because its terms are learned at
  different rates.

## Principle

**Read what is readable. Measure what is measurable. Learn only what is genuinely
unobservable.**

Sorted that way, almost nothing here is an inference problem:

| Term                               | Truth source                                      | Today                         |
| ---------------------------------- | ------------------------------------------------- | ----------------------------- |
| line height                        | computed style (the hero reports `14px / 21px …`) | fitted by regression          |
| cell padding x/y                   | `--pretable-cell-padding-x` / `-y`                | **ignored entirely**          |
| row border                         | computed style                                    | folded into a fitted "chrome" |
| text width                         | `canvas.measureText`                              | uniform average per font      |
| non-text content (custom `render`) | nothing can read it                               | learned — correctly           |

Only the last row is a real inference problem.

## Phase A — read the box from CSS

Resolve a `RowBoxMetrics` — line height, padding x and y, border — once per theme, threaded
down the route `defaultRowHeight: getThemeRowHeight()` already uses (`pretable-model.ts`).

- **Deduct `2 × padding-x` from the wrap width.** This is the outstanding bug: both
  `estimateDomRowHeight` and `predictRowLineCount` wrap at the full column width.
- **Retire the calibration's line-height and chrome fit. Keep the learned floor.** The floor
  is the one term nothing else can see. Removing the other two deletes the degenerate-fit
  hazard, the mixed-state hinge, and the mechanism that masked the padding bug by absorbing
  its error.
- Invalidate on theme change — the same hook gives the cached character width from #358 a
  home, fixing its known staleness.

**Phase A must land before Phase B.** The fitted terms absorb error; leaving them in place
would let them mask Phase B's effect, which is exactly the trap that produced a false result
earlier in this series.

## Phase B — segment-measured text

Replace `text-core`'s uniform `averageCharWidth` model with per-segment measured widths.

**Architecture: `text-core` gains an injectable measurer.** It stays DOM-free and defaults to
today's average. `packages/react` supplies a canvas-backed `measureSegment(text, font)`.
SSR and jsdom keep the average. This preserves the property that made an offscreen probe
unattractive — the layout maths stays pure and unit-testable without a browser.

Scope, informed by `@chenglou/pretext`:

- **Segment cache keyed by `(segment, font)`.** The cost model fits grid content unusually
  well: thousands of rows of prose share a small vocabulary, so distinct segments are
  measured once and later rows hit cache.
- **Grapheme segmentation** via `Intl.Segmenter` rather than code units.
- **`letter-spacing`** support, so a styled column's prediction matches CSS.
- **`white-space: pre-wrap`** handling.

Explicitly **not** in scope: emoji presentation correction and per-engine fit policies.
Pretext carries those alongside a per-browser accuracy corpus that validates them.
Reimplementing that tier without the corpus means shipping the complexity without the
evidence — if we ever need it, taking the dependency is the honest move.

## Attribution

`@chenglou/pretext` (MIT, © Pretext contributors) is the source of Phase B's design. This is
our own implementation against a different API, so the obligation is courtesy rather than
licence — but attribution goes in `LICENSE` regardless, landing with the Phase B code. If any
block ends up closely adapted rather than independently written, that file is marked and the
copyright line travels with it.

## Verification

The instrument exists: `packages/renderer-dom/src/__tests__/row-height-accuracy.test.ts` over
48 real Chromium-measured hero rows, reporting both mean `|estimate − measured|` and per-row
line counts.

Current state, to beat:

|                                       | value      |
| ------------------------------------- | ---------- |
| mean error, guessed width             | 11.52px    |
| mean error, measured width            | 8.69px     |
| mean error, measured + calibration    | **6.85px** |
| line counts correct, guessed 7px      | 43/48      |
| line counts correct, measured 6.505px | **37/48**  |

- **Phase A gate:** line-count accuracy must exceed 43/48 — beating the _guess_, not merely
  the current state — and mean error must fall below 6.85px. Anything less means the padding
  term was not the whole story and we stop to find out why.
- **Phase B gate:** further reduction in both, with a stated prediction recorded before the
  run.
- **Safety property, unchanged:** with no canvas and no theme, estimates must be
  byte-identical to today. The two pre-existing estimator tests pin this and must pass
  unedited.
- **Bench no-regression:** `row_height_error_p95_px` must not rise (baseline runset
  `2026-08-13t04-27-03-476z`: S1 1, S2 4, S3 1, S7 4). Treat it strictly as a guard — it
  compares two post-layout numbers and never consults the estimator.

## Phase A outcome — and the open question, answered

Phase A shipped as #363. Measured over the same 48 rows:

|                     | before | after      |
| ------------------- | ------ | ---------- |
| line counts correct | 37/48  | **47/48**  |
| mean error          | 8.69px | **3.50px** |

Two findings the numbers settled:

**The floor should stay a max.** With box metrics in place it changes 34 of 48 estimates and
every delta is an improvement, worth 5.94px of mean error. A running _mean_ floor (66.33)
scores 3.708 — worse than the max's 3.500. The question below is therefore answered for the
per-row objective, and the max stays.

**A systematic ~1px-per-line shortfall remains, and it is Phase B's subject.** With padding
deducted, the old 7px character guess scores a _better_ mean height error (2.646) than the
measured 6.505px (3.500) — a third cancellation in this series, the over-wide guess covering
a slight under-estimate in the box-based height. On line count, which cannot cancel, the
measured width wins 47 to 41. So the measurement is right about what the estimator models,
and the residual is in the model, not the input.

## Open question, deliberately not settled here

Since #342, a visible row's estimate is a **one-frame placeholder** — it is measured within a
frame of appearing. What persists is aggregate scroll-extent accuracy over thousands of
unmeasured rows. Per-row error and aggregate error can diverge: a systematic one-directional
bias is nearly harmless per-row and bad for scroll extent.

Our instrument measures per-row error, and against that objective the max floor is measurably
better (3.500 vs 3.708). But that is not evidence for the aggregate objective: a max floor is
biased high by construction, which is nearly harmless per-row and accumulates against a
scroll extent summed over thousands of unmeasured rows.

So the question survives Phase A in a sharper form: **the two objectives now demonstrably
prefer different answers**, and nothing in this series measures the aggregate one. Settling it
needs an instrument for scroll-extent error, not another opinion.
