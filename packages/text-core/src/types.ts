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
  wrapMode?: "wrap" | "nowrap";
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
