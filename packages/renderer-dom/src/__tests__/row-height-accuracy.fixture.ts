/**
 * Ground truth: real rows, measured by a real browser.
 *
 * Captured from the pretable.ai homepage hero in Chromium — a grid whose font
 * is NOT the one `estimateDomRowHeight`'s constants were calibrated against.
 * That is the point. The bench app renders Inter Variable, the very font those
 * constants were fitted to, so a bench-only instrument reads this estimator's
 * error at its best and cannot see the case that motivated the work.
 *
 * `heightPx` is the height the DOM settled on — the max over ALL cells in the
 * row, including a two-line custom `dayPnl` renderer the estimator is
 * structurally unable to see. Fixing that is the floor term's whole job, so
 * including it is deliberate, not a contamination.
 *
 * Regenerate by re-running the probe in Task 3b of
 * `docs/superpowers/plans/2026-08-13-row-height-estimator-calibration.md`.
 */
export interface RowHeightSample {
  readonly text: string;
  readonly widthPx: number;
  readonly heightPx: number;
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
 * The sample was the concatenated text of the 8 rendered
 * `[data-pretable-cell][data-pretable-column-id="analyst"]` cells — 801
 * graphemes of the very prose these samples wrap — measuring 5210.9326171875px
 * in total. Per-cell values ranged 6.20–6.88, so this is an average over real
 * content, not one lucky string.
 *
 * This is a captured measurement, like the heights: do not round it, tune it,
 * or extrapolate it. The estimator's guess for this font was 7 — `prepareText`
 * pattern-matches the font-key string and the key the grid passes matches none
 * of its patterns.
 */
export const HERO_AVERAGE_CHAR_WIDTH_PX = 6.505533854166667;

export const HERO_ROW_HEIGHT_SAMPLES: readonly RowHeightSample[] = [
  {
    text: "Up on hyperscaler capex headlines.hold",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Up on hyperscaler capex headlines. Position now 8.4% of book — above the 7% single-name guardrail.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Trial readout miss reported minutes ago.hold",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Trial readout miss reported minutes ago. Dividend + pipeline thesis intact; drawdown inside the 1.5σ band.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Correlates 0.71 with NVDA.hold",
    widthPx: 320,
    heightPx: 63,
  },
  {
    text: "Correlates 0.71 with NVDA. Combined AI-compute exposure 15.3% — watch if trimming into the same theme.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Recovered intraday but red vs cost basis.hold",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Recovered intraday but red vs cost basis. Beta to book is 1.8 — largest single contributor to today's vol.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Correlates 0.71 with NVDA. Combined AI-compute exposure 15.3% — watch if trimming into the same theme.watch",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Tracking crude + sector rotation.hold",
    widthPx: 320,
    heightPx: 63,
  },
  {
    text: "Tracking crude + sector rotation. Unrealized still positive; no action vs target weight.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Up on hyperscaler capex headlines. Position now 8.4% of book — above the 7% single-name guardrail.trim",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Momentum strong into the print.hold",
    widthPx: 320,
    heightPx: 63,
  },
  {
    text: "Momentum strong into the print. Options skew rich; size is already at the model cap.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Net-interest-income guide reaffirmed.hold",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Net-interest-income guide reaffirmed. Defensive ballast for the book; hold at weight.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Headline risk on a regulatory probe.hold",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Headline risk on a regulatory probe. Flagged for review — drawdown breached the 2σ stop band.hold",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Correlates 0.71 with NVDA.watch",
    widthPx: 320,
    heightPx: 63,
  },
  {
    text: "Recovered intraday but red vs cost basis.watch",
    widthPx: 320,
    heightPx: 68,
  },
  {
    text: "Recovered intraday but red vs cost basis. Beta to book is 1.8 — largest single contributor to today's vol.watch",
    widthPx: 320,
    heightPx: 89,
  },
  {
    text: "Momentum strong into the print.watch",
    widthPx: 320,
    heightPx: 63,
  },
  {
    text: "Momentum strong into the print. Options skew rich; size is already at the model cap.watch",
    widthPx: 320,
    heightPx: 89,
  },
];
