export interface PrepareTextInput {
  text: string;
  fontKey: string;
  averageCharWidth?: number;
  /**
   * Advance width of `segment`, in px, in the caller's font.
   *
   * The caller owns the font — `text-core` never sees one, which is what keeps
   * this package DOM-free. When supplied, `prepareText` measures each distinct
   * token exactly once and `layoutPreparedText` wraps by accumulated pixel
   * width instead of by `averageCharWidth`.
   */
  measureSegment?: (segment: string) => number;
  /**
   * CSS `letter-spacing` for this text, in px.
   *
   * CSS adds the spacing after **every** grapheme, the last one of a line
   * included — so a run of `n` graphemes occupies `n × (advance + spacing)`,
   * not `n × advance + (n - 1) × spacing`. That is not an assumption: it was
   * measured in Chromium 1234, WebKit 2336 and Firefox 1532 via Playwright
   * with `font: 20px monospace` and `letter-spacing: 10px`. For the 11-char
   * string `"aaaaa aaaaa"` all three reported an inline width exactly
   * `11 × 10 = 110px` wider than the unspaced run, and all three needed a
   * container of ~242px (= `11 × (12.0 + 10)`) to keep it on one line — at
   * ~232px (the trailing-trimmed prediction) it wrapped to two lines. The
   * engines do not diverge here.
   *
   * Applies on both paths: it folds into `averageCharWidth` on the average
   * path and into each entry of `tokenWidthsPx` on the measured path, so the
   * two stay in agreement. `undefined` and `0` leave every output untouched.
   */
  letterSpacingPx?: number;
}

export interface PreparedTextToken {
  kind: "word" | "space" | "newline";
  value: string;
  length: number;
}

export interface PreparedText {
  text: string;
  fontKey: string;
  graphemeCount: number;
  breakpoints: number[];
  /**
   * Effective advance of one grapheme in px — the average character width
   * **plus** `letterSpacingPx`, because CSS charges the spacing against every
   * grapheme including a line's last. With no letter spacing this is exactly
   * the supplied `averageCharWidth`.
   */
  averageCharWidth: number;
  tokens: PreparedTextToken[];
  /**
   * Advance width in px of each entry of `tokens`, index-aligned with it.
   *
   * Present only when `prepareText` was given a `measureSegment`. Its presence
   * is what switches `layoutPreparedText` onto the measured path, so without a
   * measurer the record is byte-identical to one from before measurement
   * existed.
   */
  tokenWidthsPx?: number[];
}

export type PreparedTextRecord = PreparedText;

export interface LayoutPreparedTextOptions {
  lineHeightPx?: number;
  paddingBlockPx?: number;
  /**
   * How the text wraps, mirroring CSS `white-space`.
   *
   * - `wrap` — soft-wrap at token boundaries, whitespace at the start of a
   *   line dropped. `\n` still breaks.
   * - `nowrap` — one line per `\n`, width reported as the intrinsic width.
   * - `pre-wrap` — whitespace is **preserved**: a space run is charged to the
   *   line it starts on, at the start of a line as anywhere else, and never
   *   moves to the next line. `\n` breaks.
   *
   * The `pre-wrap` rules were measured, not assumed — see `layout-text.ts`,
   * which records the Chromium and WebKit probe behind them.
   */
  wrapMode?: "wrap" | "nowrap" | "pre-wrap";
}

export interface PreparedTextLayout {
  lineCount: number;
  height: number;
  measuredWidth: number;
  overflowX: boolean;
}

export interface DomTruthMeasurement {
  lineCount: number;
  height: number;
}

export interface ComparePreparedTextToDomTruthResult {
  ok: boolean;
  estimate: PreparedTextLayout;
  truth: DomTruthMeasurement;
  error: null | {
    reason:
      | "line-count-mismatch"
      | "height-mismatch"
      | "line-count-and-height-mismatch";
    lineCountDelta: number;
    heightDelta: number;
  };
}
