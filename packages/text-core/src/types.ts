export interface PrepareTextInput {
  text: string;
  fontKey: string;
  averageCharWidth?: number;
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
  error:
    | null
    | {
        reason:
          | "line-count-mismatch"
          | "height-mismatch"
          | "line-count-and-height-mismatch";
        lineCountDelta: number;
        heightDelta: number;
      };
}
