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
