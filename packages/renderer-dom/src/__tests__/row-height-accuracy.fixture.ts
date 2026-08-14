import type { CellWrapMode, RenderAdvance } from "../types";

/**
 * Ground truth: real rows, measured by a real browser.
 *
 * Captured from the pretable.ai homepage hero in Chromium — a grid whose font
 * is NOT the one `estimateDomRowHeight`'s constants were calibrated against.
 * That is the point. The bench app renders Inter Variable, the very font those
 * constants were fitted to, so a bench-only instrument reads this estimator's
 * error at its best and cannot see the case that motivated the work.
 *
 * `text` is the RAW CELL VALUE the estimator reads — not the analyst cell's
 * rendered `textContent`. Do not re-capture it with `textContent`, however
 * convenient that is. The hero renders a stance badge (`hold` / `watch` /
 * `trim` / `risk`) inside the cell via a `render` prop, so `textContent`
 * carries 4-5 characters that `estimateDomRowHeight` never sees: it reads
 * `readCellValue(row, column)`, the raw `analyst` string off the row object.
 * At ~6.51px per character in a 320px column — about 49 characters a line —
 * those few characters are enough to push a genuinely 2-line row to a predicted
 * 3, which biased every error the previous version of this fixture reported, in
 * one direction. That was a fault in the instrument, not in the estimator, and
 * it is exactly the measuring-the-wrong-thing this fixture now exists to avoid.
 * Each sample's text was taken by cloning the cell and removing its
 * `[data-pretable-badge]` node, and every captured string was checked to end in
 * none of the four stances.
 *
 * The badge is still in the DOM and still occupies inline space, so it can push
 * a string onto another line. That is removable from the TEXT but not from the
 * HEIGHT, and it is unmodellable from the row value — the same way the two-line
 * `dayPnl` renderer is.
 *
 * `heightPx` is the height the DOM settled on — the max over ALL cells in the
 * row, including that `dayPnl` renderer. Fixing that is the floor term's whole
 * job, so including it is deliberate, not a contamination. It is read from
 * `data-pretable-row-height` AFTER it settles: that attribute is the row
 * model's planned height, which is the estimate for one frame and the
 * measurement thereafter. Every sample was cross-checked against the row's own
 * `getBoundingClientRect().height` at capture time and all 48 agreed, so
 * nothing here is the estimator grading its own homework.
 *
 * `lineCount` is how many lines Chromium actually wrapped `text` into, and it
 * is NOT derivable from `heightPx`: the row height is the max over every cell,
 * so a 1-line analyst cell in a row with a two-line `dayPnl` reads the same
 * height as a 2-line one. It was measured on the analyst text node directly —
 * a `Range` over it, counting distinct line-box tops — and cross-checked
 * against `boundingRect.height / lineHeight`; both methods agreed on all 48.
 * An earlier version of the line-count test inferred line counts from
 * `heightPx` instead and concluded that the 89px rows were 2 lines. They are 3.
 *
 * The hero yields only 16 distinct raw strings (8 commentary scripts x 2
 * streamed chunks), so the capture runs three passes and drags the analyst
 * column's resize handle between them: 320px untouched, then 248px and 404px.
 * Three wrap widths is also strictly better coverage than the single 320px this
 * fixture used to have. The handle is only hit-testable once the grid is
 * scrolled fully right — the analyst column is last and its trailing edge sits
 * outside the scroll viewport.
 *
 * Regenerate by re-running the probe in Task 3b of
 * `docs/superpowers/plans/2026-08-13-row-height-estimator-calibration.md`.
 */
export interface RowHeightSample {
  readonly text: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Line boxes Chromium wrapped `text` into at `widthPx`. Measured, not derived. */
  readonly lineCount: number;
}

/**
 * The hero grid's real average character width, in pixels.
 *
 * Measured in the same Chromium session that produced the heights below, with
 * the same method `packages/react/src/text-metrics.ts` uses in production:
 * `canvas.measureText(sample).width / graphemeCount`, with the measuring
 * context's `font` set to the analyst cell's computed `font` shorthand:
 *
 *   "14px / 21px ui-sans-serif, system-ui, -apple-system, \"system-ui\",
 *    \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
 *
 * The sample was the concatenated RAW text of the 8 rendered
 * `[data-pretable-cell][data-pretable-column-id="analyst"]` cells, badge nodes
 * removed for the same reason the samples below have them removed — 762
 * graphemes of the very prose these samples wrap, measuring
 * 4956.8955078125px in total. Per-cell values ranged 6.17-6.87, so this is an
 * average over real content, not one lucky string.
 *
 * This is a captured measurement, like the heights: do not round it, tune it,
 * or extrapolate it. The estimator's guess for this font was 7 — `prepareText`
 * pattern-matches the font-key string and the key the grid passes matches none
 * of its patterns.
 */
export const HERO_AVERAGE_CHAR_WIDTH_PX = 6.505112214977034;

/**
 * The hero grid's real row box, as CSS states it.
 *
 * Captured the same way `HERO_AVERAGE_CHAR_WIDTH_PX` was — a throwaway
 * Playwright probe against a production build of the site served locally,
 * reading `getComputedStyle` of the same
 * `[data-pretable-cell][data-pretable-column-id="analyst"]` cell the samples
 * below were taken from, at a 1440x900 viewport after the streamed commentary
 * had settled. The probe printed:
 *
 *   font:              "14px / 21px ui-sans-serif, system-ui, -apple-system, …"
 *   line-height:       "21px"
 *   padding-left:      "16px"
 *   padding-right:     "16px"
 *   padding-top:       "12px"
 *   padding-bottom:    "12px"
 *   border-bottom:     "1px"   (on the cell; the row element has none)
 *   --pretable-rule-width: "1px"
 *   cell width:        320px   (the untouched analyst column)
 *
 * There is no `--pretable-line-height` token, so line height is only ever
 * resolvable from a rendered cell; padding and rule width do have tokens, and
 * the computed values match them exactly (16/12/1).
 *
 * ## `lineHeightPx` is 20.3, not the 21 the CELL reports
 *
 * The 21px above is the CELL's. It is not the number the wrapped text is laid
 * out at, and recording it here charged the estimator 0.7px a line too much
 * for as long as this fixture has existed. The hero renders
 * `<div data-pretable-cell><span class="analyst">text<span class="analystFlag"/></span></div>`;
 * the cell is `display: flex`, so the span establishes its own inline
 * formatting context and its line boxes are the ones being counted. `.analyst`
 * sets `line-height: 1.45` on a 14px font.
 *
 * Re-captured for this task with a throwaway Playwright probe against the same
 * production build of the site served locally, same 1440x900 viewport, same
 * wait for the streamed commentary to settle, reading `getComputedStyle` of
 * the element `findTextLayoutElement` (`packages/react/src/density.ts`) picks
 * out of the same `[data-pretable-cell][data-pretable-column-id="analyst"]`
 * cell — the rule the shipped code now uses, reimplemented in page context so
 * the capture is independent of the bundle rather than a re-export of it. The
 * probe printed, for `span.cells-module__analyst`:
 *
 *   font:              "14px / 20.3px ui-sans-serif, system-ui, -apple-system, …"
 *   line-height:       "20.3px"
 *   display:           "block"
 *
 * and, for the cell it descended from, the identical 21px / 16 / 12 / 1 / 320px
 * recorded above — so this is the same box as before with one term corrected,
 * not a different capture.
 *
 * 20.3 is also what PR #370 derived WITHOUT assuming it: from `Math.ceil`
 * constraints on the four measured heights alone it bounded the line advance at
 * `20 < a < 21`. Two independent derivations, one from CSS and one from height
 * arithmetic.
 *
 * Note what this does NOT fix, because the instruments now show it plainly: the
 * estimator models a row as `chrome + n x lineHeight`, and the browser's last
 * line box is TALLER than a line here — the inline-flex badge sits on it and
 * measures 21.25px tall against a 20.3px line. Correcting 21 -> 20.3 removes
 * the over-statement that was standing in for that. See the PR for the numbers.
 *
 * `borderPx` is the CELL's bottom rule, not the row element's: the row carries
 * no border at all, so reading it there would have yielded 0 and understated
 * the chrome by a pixel per row.
 *
 * These are captured measurements, like the heights and the character width:
 * do not round them, tune them, or substitute the theme defaults for them.
 * Note in particular that they are NOT the estimator's no-box constants
 * (`ROW_LINE_HEIGHT` 24, `ROW_CHROME_HEIGHT` 42, and no padding deducted at
 * all) — that mismatch is the whole subject of this fixture.
 */
export interface HeroRowBoxMetrics {
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly borderPx: number;
  readonly wrapMode?: CellWrapMode;
}

/**
 * The `white-space` the hero's wrapped cells are actually laid out under.
 *
 * Captured alongside the whitespace samples below, in the same probe and the
 * same session: `getComputedStyle` of the element `findTextLayoutElement`
 * picks out of a `[data-pretable-cell][data-pretable-column-id="analyst"]`
 * cell reported `white-space: pre-wrap`, and so did the cell itself — the
 * surface sets it inline and the `.analyst` span inherits it. `tab-size` came
 * back `4`.
 *
 * This is a MEASUREMENT, not a restatement of what `pretable-surface.tsx`
 * writes, and it is the number the estimator was disagreeing with: both of its
 * paths hardcoded `text-core`'s `wrap`, which is `white-space: normal`.
 */
export const HERO_WRAP_MODE: CellWrapMode = "pre-wrap";

export const HERO_ROW_BOX_METRICS: HeroRowBoxMetrics = {
  lineHeightPx: 20.3,
  paddingXPx: 16,
  paddingYPx: 12,
  borderPx: 1,
} as const;

/**
 * The box as this fixture recorded it before Task 3 — line height read from the
 * CELL rather than from the element laying the text out.
 *
 * Kept so the instruments can report the correction as a comparison rather than
 * a replacement, the same way `HERO_AVERAGE_CHAR_WIDTH_PX` is reported against
 * the 7px guess it displaced. Nothing ships against this; it is the BEFORE
 * column.
 */
export const HERO_ROW_BOX_METRICS_CELL_LINE_HEIGHT: HeroRowBoxMetrics = {
  ...HERO_ROW_BOX_METRICS,
  lineHeightPx: 21,
} as const;

/**
 * How much horizontal space the analyst column's `render` draws beside its text.
 *
 * The hero's analyst renderer emits the raw string followed by an inline stance
 * badge (`hold` / `watch` / `trim` / `risk`). `estimateDomRowHeight` wraps
 * `readCellValue(row, column)` — the raw string — so the badge is invisible to
 * it while still consuming width on the line. This is the number that makes it
 * visible, and it is the fixture's stand-in for what
 * `getGridRenderAdvances()` resolves live in `packages/react/src/density.ts`.
 *
 * Same provenance discipline, same session, and the same probe that re-captured
 * the 20.3px line height above: the advance is the summed outer width (border
 * box plus horizontal margins) of the layout element's ELEMENT children — the
 * definition the shipped `measureRenderAdvance` uses, reimplemented in page
 * context. The probe printed one child:
 *
 *   span.cells-module__analystFlag
 *     client rects:  1          (exactly one, or the shipped rule declines)
 *     width:         53.390625px
 *     height:        21.25px
 *     margin-left:   6px
 *     margin-right:  0px
 *     outer width:   59.390625px
 *
 * Cross-check that could have failed: PR #370 bounded this advance at
 * `(58.61, 64.82] px` from horizontal slack alone — the widest last-line slack
 * among rows whose height says the badge wrapped, against the narrowest among
 * rows whose height says it fitted — using no width measurement of the badge at
 * all. 59.390625 lands inside it.
 *
 * The 21.25px height is recorded because it is not decoration: it is TALLER
 * than the 20.3px line the text is laid out at, which is why the row a browser
 * draws is a couple of pixels above `chrome + n x 20.3`. That is the last line
 * box, captured below — and note before reading it that 21.25 is NOT the
 * answer.
 */
export const HERO_RENDER_ADVANCE_PX = 59.390625;

/**
 * The height of the line box the badge sits on: **22.61875px**, against a
 * 20.3px line.
 *
 * The estimator charged `L x lineHeight` for a wrapped cell until this existed.
 * The browser charges `(L - 1) x lineHeight + thisNumber`, because a line box
 * is as tall as the tallest thing on it and the badge sits on the last line.
 * 2.31875px per wrapped row, and the last of the five compensating pairs this
 * series has unwound: the 21px cell line height that Task 3 corrected had been
 * standing in for it.
 *
 * ## Measured, and the obvious model is wrong
 *
 * `max(lineHeight, badgeHeight)` is 21.25px. It is not what Chromium does, and
 * the only reason we know is the probe. Same session and same discipline as the
 * capture above, against the running hero: clones of the real `span.analyst`
 * appended to the real cell, so the inherited font and line-height are the live
 * ones, with a zero-size `inline-block` appended to read the baseline's y.
 *
 *   line-height (computed)              20.3px    (laid out at 20.296875px)
 *   badge border box                    21.25px
 *   strut       ascent / descent        14.99375 / 5.296875
 *   badge       ascent / descent        13.625   / 7.625
 *   last line box, measured             22.61875px
 *   max(lineHeight, badge height)       21.25px      <- the assumed model
 *   max(ascents) + max(descents)        22.61875px   <- what the browser does
 *
 * The badge is `vertical-align: baseline`, so its box is split at ITS baseline
 * and each half maxed against the strut's. It is shorter than the strut above
 * the baseline and taller below it, so the line box exceeds BOTH boxes. Forcing
 * `vertical-align: top` on the same badge collapses the line box to 21.24375px
 * — the `max` model — which is how the baseline split was confirmed as the
 * cause rather than a coincidence of these numbers.
 *
 * Controls from the same probe, both of which could have failed:
 *
 *   - badge deleted from the clone: last line box 20.290625px, i.e. the line
 *     height. Nothing else in that cell is tall.
 *   - the 22.61875 leftover is identical across cells whose badge shares the
 *     last text line and cells whose badge was pushed onto a line of its own.
 *
 * ## The residual it leaves, exactly
 *
 * With this term the model reproduces the measured heights to the pixel, and
 * what is left is `Math.ceil`:
 *
 *   L=2   20.3 + 22.61875 + 25 =  67.91875  ->  ceil 68   (measured 68)
 *   L=3   40.6 + 22.61875 + 25 =  88.21875  ->  ceil 89   (measured 89)
 *   L=4   60.9 + 22.61875 + 25 = 108.51875  ->  ceil 109  (measured 109)
 *
 * `measureRenderedRowHeight` in `packages/react/src/row-height.ts` rounds the
 * measured content height UP to whole pixels, so a row's recorded height is the
 * ceiling of what the estimator models. That is a sixth term, it is bounded by
 * 1px, and it is one-sided by construction. This fixture does not model it.
 */
export const HERO_LAST_LINE_BOX_PX = 22.61875;

/**
 * The advance keyed by column id, in the shape the estimator takes it — WIDTH
 * ONLY, which is the configuration Task 3 shipped and measured.
 *
 * Kept as the two-term column of every comparison below rather than upgraded in
 * place: the tests written against it are the record of what those two fixes
 * did, and re-scoring them under a third would erase it.
 *
 * A `ReadonlyMap`, and a single frozen instance, because the map's IDENTITY is
 * part of the estimate memo key in `create-renderer.ts`. Handing out a fresh
 * map per call would work here but would model the production contract wrongly.
 */
export const HERO_RENDER_ADVANCES: ReadonlyMap<string, RenderAdvance> = new Map(
  [["analyst", { widthPx: HERO_RENDER_ADVANCE_PX, lastLineBoxPx: null }]],
);

/**
 * Both measured terms: the width the badge consumes and the line box it makes.
 * What `getGridRenderAdvances()` now resolves live off the hero.
 */
export const HERO_RENDER_ADVANCES_WITH_LINE_BOX: ReadonlyMap<
  string,
  RenderAdvance
> = new Map([
  [
    "analyst",
    { widthPx: HERO_RENDER_ADVANCE_PX, lastLineBoxPx: HERO_LAST_LINE_BOX_PX },
  ],
]);

/**
 * The advance width, in px, of every token the samples below tokenize into.
 *
 * Same provenance discipline as `HERO_AVERAGE_CHAR_WIDTH_PX`: measured, not
 * derived, with `canvas.measureText` in the headless Chromium bundled with
 * Playwright 1.62.1 on the capture machine, with the measuring context's `font`
 * set to the analyst cell's computed shorthand recorded above. The keys are
 * exactly what `text-core`'s tokenizer produces for these strings, so every
 * lookup the estimator makes is present, and `measureHeroSegment` below THROWS
 * on a miss rather than defaulting to zero — a zero would silently turn a
 * tokenizer change into a suspiciously good score.
 *
 * Cross-check on the capture environment, because a browser measurement taken
 * in a different session is only useful if it is the same measurement: the
 * concatenated raw text of the 8 full-length analyst strings — 762 graphemes,
 * the same corpus `HERO_AVERAGE_CHAR_WIDTH_PX` was averaged over — measures
 * 4957.4423828125px here against the 4956.8955078125px recorded then. That is
 * 0.011 per cent apart, or 0.0007px per grapheme: the same font, the same
 * rasterizer, and a residual far too small to move a wrap decision. It is NOT
 * bit-identical, and that is recorded rather than smoothed over.
 *
 * Node has no canvas, so this table is how a Node-side test exercises the
 * measured path at all. Regenerate it the same way if the samples change.
 */
export const HERO_SEGMENT_WIDTHS_PX: Readonly<Record<string, number>> = {
  "\t": 3.787109375,
  "\t\t": 7.57421875,
  "\t\t\t\t\t\t": 22.72265625,
  "\t\t\t\t\t\t\t": 26.509765625,
  "\t\t\t\t\t\t\t\t\t\t\t": 41.658203125,
  "\t\t\t\t\t\t\t\t\t\t\t\t": 45.4453125,
  " ": 3.787109375,
  "   ": 11.361328125,
  "    ": 15.1484375,
  "        ": 30.296875,
  "         ": 34.083984375,
  "                      ": 83.31640625,
  "                       ": 87.103515625,
  "                           ": 102.251953125,
  "                            ": 106.0390625,
  "                              ": 113.61328125,
  "                               ": 117.400390625,
  "+": 8.66796875,
  "0.71": 25.8125,
  "1.5σ": 26.783203125,
  "1.8": 18.3203125,
  "15.3%": 39.3955078125,
  "2σ": 16.9462890625,
  "7%": 20.6240234375,
  "8.4%": 33.5712890625,
  "AI-compute": 76.26171875,
  Beta: 29.408203125,
  Combined: 66.0966796875,
  Correlates: 66.9580078125,
  "Correlates.": 70.9638671875,
  Defensive: 63.8408203125,
  Dividend: 56.8408203125,
  Flagged: 51.884765625,
  Headline: 56.6767578125,
  Momentum: 73.08984375,
  "NVDA.": 42.35546875,
  "Net-interest-income": 131.2705078125,
  Options: 50.6064453125,
  Position: 51.529296875,
  Recovered: 68.455078125,
  Tracking: 55.2958984375,
  Trial: 27.15234375,
  Unrealized: 68.7763671875,
  Up: 18.56640625,
  a: 7.57421875,
  above: 38.8828125,
  action: 39.7783203125,
  "ago.": 27.9453125,
  already: 47.263671875,
  at: 12.509765625,
  ballast: 42.423828125,
  "band.": 36.4970703125,
  "basis.": 37.693359375,
  book: 32.142578125,
  "book.": 36.1484375,
  "book;": 36.1484375,
  breached: 60.9150390625,
  but: 21.4033203125,
  "cap.": 27.521484375,
  capex: 38.41796875,
  contributor: 71.8525390625,
  cost: 27.849609375,
  crude: 37.1806640625,
  drawdown: 66.2880859375,
  exposure: 59.3017578125,
  for: 17.91015625,
  "guardrail.": 60.8603515625,
  guide: 36.0048828125,
  "headlines.": 65.70703125,
  hold: 28.0478515625,
  hyperscaler: 75.4072265625,
  if: 8.2236328125,
  inside: 38.1103515625,
  intact: 36.5927734375,
  "intact.": 40.5986328125,
  "intact;": 40.5986328125,
  into: 24.28125,
  intraday: 52.2197265625,
  is: 10.486328125,
  largest: 44.21484375,
  minutes: 51.2353515625,
  miss: 29.55859375,
  model: 39.83984375,
  no: 16.1396484375,
  now: 26.5576171875,
  of: 13.0361328125,
  on: 16.1396484375,
  pipeline: 50.5107421875,
  "positive;": 54.263671875,
  "print.": 33.8447265625,
  "probe.": 41.794921875,
  readout: 49.9228515625,
  "reaffirmed.": 71.189453125,
  red: 21.2734375,
  regulatory: 65.84375,
  reported: 55.7880859375,
  review: 41.97265625,
  "rich;": 28.2666015625,
  risk: 23.119140625,
  "rotation.": 53.9970703125,
  same: 34.630859375,
  sector: 40.9814453125,
  single: 38.1240234375,
  "single-name": 80.048828125,
  size: 25.525390625,
  skew: 32.826171875,
  still: 22.134765625,
  stop: 28.4580078125,
  strong: 41.5419921875,
  target: 38.650390625,
  the: 20.8701171875,
  "theme.": 44.7548828125,
  thesis: 38.5341796875,
  to: 12.9541015625,
  "today's": 47.3388671875,
  "today.": 39.1357421875,
  trimming: 57.1962890625,
  "vol.": 22.681640625,
  vs: 14.41015625,
  watch: 38.6640625,
  "weight.": 46.9833984375,
  with: 27.0224609375,
  "—": 12.0859375,
};

/**
 * A `measureSegment` over the fixture's vocabulary, for tests that drive
 * `estimateDomRowHeight` under Node.
 *
 * Throws on an unmeasured token on purpose. Returning 0, or falling back to the
 * average width, would let a tokenizer change quietly produce narrower text and
 * a better-looking line count.
 */
export function measureHeroSegment(segment: string): number {
  const width = HERO_SEGMENT_WIDTHS_PX[segment];
  if (width === undefined) {
    throw new Error(
      `No captured width for ${JSON.stringify(segment)}. Re-capture HERO_SEGMENT_WIDTHS_PX.`,
    );
  }
  return width;
}

export const HERO_ROW_HEIGHT_SAMPLES: readonly RowHeightSample[] = [
  {
    text: "Up on hyperscaler capex headlines.",
    widthPx: 320,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Up on hyperscaler capex headlines. Position now 8.4% of book — above the 7% single-name guardrail.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Trial readout miss reported minutes ago.",
    widthPx: 320,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Trial readout miss reported minutes ago. Dividend + pipeline thesis intact; drawdown inside the 1.5σ band.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Correlates 0.71 with NVDA.",
    widthPx: 320,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Correlates 0.71 with NVDA. Combined AI-compute exposure 15.3% — watch if trimming into the same theme.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Recovered intraday but red vs cost basis.",
    widthPx: 320,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Recovered intraday but red vs cost basis. Beta to book is 1.8 — largest single contributor to today's vol.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Tracking crude + sector rotation.",
    widthPx: 320,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Tracking crude + sector rotation. Unrealized still positive; no action vs target weight.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 2,
  },
  {
    text: "Momentum strong into the print.",
    widthPx: 320,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Momentum strong into the print. Options skew rich; size is already at the model cap.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 2,
  },
  {
    text: "Net-interest-income guide reaffirmed.",
    widthPx: 320,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Net-interest-income guide reaffirmed. Defensive ballast for the book; hold at weight.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Headline risk on a regulatory probe.",
    widthPx: 320,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Headline risk on a regulatory probe. Flagged for review — drawdown breached the 2σ stop band.",
    widthPx: 320,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Up on hyperscaler capex headlines.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Up on hyperscaler capex headlines. Position now 8.4% of book — above the 7% single-name guardrail.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 4,
  },
  {
    text: "Trial readout miss reported minutes ago.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Trial readout miss reported minutes ago. Dividend + pipeline thesis intact; drawdown inside the 1.5σ band.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 4,
  },
  {
    text: "Correlates 0.71 with NVDA.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Correlates 0.71 with NVDA. Combined AI-compute exposure 15.3% — watch if trimming into the same theme.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 4,
  },
  {
    text: "Recovered intraday but red vs cost basis.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Recovered intraday but red vs cost basis. Beta to book is 1.8 — largest single contributor to today's vol.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 4,
  },
  {
    text: "Tracking crude + sector rotation.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Tracking crude + sector rotation. Unrealized still positive; no action vs target weight.",
    widthPx: 248,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Momentum strong into the print.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 1,
  },
  {
    text: "Momentum strong into the print. Options skew rich; size is already at the model cap.",
    widthPx: 248,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Net-interest-income guide reaffirmed.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Net-interest-income guide reaffirmed. Defensive ballast for the book; hold at weight.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 3,
  },
  {
    text: "Headline risk on a regulatory probe.",
    widthPx: 248,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Headline risk on a regulatory probe. Flagged for review — drawdown breached the 2σ stop band.",
    widthPx: 248,
    heightPx: 109,
    lineCount: 4,
  },
  {
    text: "Up on hyperscaler capex headlines. Position now 8.4% of book — above the 7% single-name guardrail.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Trial readout miss reported minutes ago.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Trial readout miss reported minutes ago. Dividend + pipeline thesis intact; drawdown inside the 1.5σ band.",
    widthPx: 404,
    heightPx: 89,
    lineCount: 2,
  },
  {
    text: "Correlates 0.71 with NVDA.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Correlates 0.71 with NVDA. Combined AI-compute exposure 15.3% — watch if trimming into the same theme.",
    widthPx: 404,
    heightPx: 89,
    lineCount: 3,
  },
  {
    text: "Recovered intraday but red vs cost basis.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Recovered intraday but red vs cost basis. Beta to book is 1.8 — largest single contributor to today's vol.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Tracking crude + sector rotation.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Tracking crude + sector rotation. Unrealized still positive; no action vs target weight.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Momentum strong into the print.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Momentum strong into the print. Options skew rich; size is already at the model cap.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Net-interest-income guide reaffirmed.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Net-interest-income guide reaffirmed. Defensive ballast for the book; hold at weight.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Headline risk on a regulatory probe.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
  {
    text: "Headline risk on a regulatory probe. Flagged for review — drawdown breached the 2σ stop band.",
    widthPx: 404,
    heightPx: 68,
    lineCount: 2,
  },
  {
    text: "Up on hyperscaler capex headlines.",
    widthPx: 404,
    heightPx: 63,
    lineCount: 1,
  },
];

/**
 * Whitespace-bearing samples, measured the same way — the case the 48 rows
 * above cannot see.
 *
 * Not one of `HERO_ROW_HEIGHT_SAMPLES` contains a whitespace run, a tab or a
 * newline: the hero writes ordinary prose. So an estimator that models wrapped
 * cells as `white-space: normal` — collapsing runs, dropping whitespace at the
 * start of a line — scores identically on that fixture to one that models them
 * as `pre-wrap`, which is what `pretable-surface.tsx` actually sets on every
 * wrapped cell. These rows are the instrument for that difference, and they
 * were added before the difference was fixed, so that the fix could be graded
 * by something able to fail.
 *
 * ## How they were captured
 *
 * Same production build of the site served locally, same 1440x900 Chromium,
 * same wait for the streamed commentary to settle as every measurement above.
 * The hero's own content has no whitespace runs to capture, so the strings are
 * synthetic — but the LAYOUT is not. The probe clones a rendered
 * `[data-pretable-cell][data-pretable-column-id="analyst"]`, removes its
 * `[data-pretable-badge]` node for the same reason the samples above have
 * theirs removed, appends the clone to the very same parent, gives it an
 * explicit width, and writes the sample string into the element
 * `findTextLayoutElement` picks out. The clone keeps its classes and its place
 * in the tree, so its computed style is the real cell's: `white-space:
 * pre-wrap`, `overflow-wrap: anywhere`, `tab-size: 4`, `14px / 20.3px` in the
 * same font stack, 16px horizontal and 12px vertical padding, a 1px rule.
 * These are measurements of pretable's own rendering, not of a synthetic page.
 *
 * `lineCount` is a `Range` over the text, counting distinct line-box tops —
 * the method the 48 rows used — and every value agreed with
 * `boundingRect.height / lineHeight` to within 0.0004 of an integer.
 * `heightPx` is the CLONE's own settled border-box height, which is what makes
 * it comparable at all: these strings sit in no real row, so there is no
 * max-over-cells and no two-line `dayPnl` renderer inside it. Read it as the
 * cell height it is — `lineCount × 20.296875 + 25` to the pixel — and NOT as
 * one of the 63/68/89/109 row heights above. That is why they are a separate
 * array: mixing them in would silently redefine what `heightPx` means for the
 * 48 rows every earlier PR in this series reported on.
 *
 * ## Why they come in pairs
 *
 * Each pair differs by exactly ONE whitespace character, and the browser draws
 * the two members one line box apart. That is the whole argument in two rows:
 * under a collapsing model the members of a pair are the same string and must
 * wrap identically, so a pair the browser separates is a model the browser is
 * not running. The run lengths are not guesses — a sweep of run length 0..44 at
 * each width located every threshold, and each pair straddles one. The final
 * entry is a bare newline with no run at all, pinned because BOTH models break
 * on `\n` and it must not move.
 *
 * The tab samples are included knowing they are only partly modellable. CSS
 * advances a tab to the next `tab-size` stop, which depends on where the pen
 * already is, while `canvas.measureText("\t")` reports a flat 3.787px — one
 * space — so a tab run is under-charged under either model. They are kept
 * because under-charging a preserved run is still nearer than collapsing it
 * away, and because leaving the case out of the fixture is exactly how it stays
 * invisible.
 *
 * ## Cross-check on the capture environment
 *
 * 13 of the 34 distinct tokens in these strings already had captured widths in
 * `HERO_SEGMENT_WIDTHS_PX` — `Beta`, `Correlates`, `Dividend`, `Trial`,
 * `above`, `the` and a single space among them — and all 13 came back
 * BIT-IDENTICAL in this session. Same font, same rasterizer: the 21 new entries
 * merged into that table are the same measurement as the ones already there.
 */
export const HERO_WHITESPACE_SAMPLES: readonly RowHeightSample[] = [
  {
    text: "Beta   Correlates above the book.",
    widthPx: 248,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Beta    Correlates above the book.",
    widthPx: 248,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "        Dividend thesis intact today.",
    widthPx: 248,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "         Dividend thesis intact today.",
    widthPx: 248,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta\tCorrelates above the book.",
    widthPx: 248,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Beta\t\tCorrelates above the book.",
    widthPx: 248,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta Correlates.\n                              Dividend intact.",
    widthPx: 248,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta Correlates.\n                               Dividend intact.",
    widthPx: 248,
    heightPx: 85.890625,
    lineCount: 3,
  },
  {
    text: "Beta                      Correlates above the book.",
    widthPx: 320,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Beta                       Correlates above the book.",
    widthPx: 320,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "                           Dividend thesis intact today.",
    widthPx: 320,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "                            Dividend thesis intact today.",
    widthPx: 320,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Trial readout miss reported        minutes ago.",
    widthPx: 320,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Trial readout miss reported         minutes ago.",
    widthPx: 320,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta\t\t\t\t\t\tCorrelates above the book.",
    widthPx: 320,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Beta\t\t\t\t\t\t\tCorrelates above the book.",
    widthPx: 320,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Trial readout miss reported                              minutes ago.",
    widthPx: 404,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Trial readout miss reported                               minutes ago.",
    widthPx: 404,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta\t\t\t\t\t\t\t\t\t\t\tCorrelates above the book.",
    widthPx: 404,
    heightPx: 45.296875,
    lineCount: 1,
  },
  {
    text: "Beta\t\t\t\t\t\t\t\t\t\t\t\tCorrelates above the book.",
    widthPx: 404,
    heightPx: 65.59375,
    lineCount: 2,
  },
  {
    text: "Beta Correlates.\nDividend intact.",
    widthPx: 320,
    heightPx: 65.59375,
    lineCount: 2,
  },
];
