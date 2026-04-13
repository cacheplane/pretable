import { layoutPreparedText } from "./layout-text";
import type {
  ComparePreparedTextToDomTruthResult,
  DomTruthMeasurement,
  LayoutPreparedTextOptions,
  PreparedText,
} from "./types";

export function comparePreparedTextToDomTruth(
  prepared: PreparedText,
  width: number,
  options: LayoutPreparedTextOptions,
  truth:
    | DomTruthMeasurement
    | ((
        estimate: ReturnType<typeof layoutPreparedText>,
        prepared: PreparedText,
      ) => DomTruthMeasurement),
): ComparePreparedTextToDomTruthResult {
  const estimate = layoutPreparedText(prepared, width, options);
  const measurement =
    typeof truth === "function" ? truth(estimate, prepared) : truth;
  const lineCountDelta = measurement.lineCount - estimate.lineCount;
  const heightDelta = measurement.height - estimate.height;

  if (lineCountDelta === 0 && heightDelta === 0) {
    return {
      ok: true,
      estimate,
      truth: measurement,
      error: null,
    };
  }

  return {
    ok: false,
    estimate,
    truth: measurement,
    error: {
      reason: getReason(lineCountDelta, heightDelta),
      lineCountDelta,
      heightDelta,
    },
  };
}

export function createDomTruthMeasurement(
  lineCount: number,
  lineHeightPx: number,
  paddingBlockPx = 0,
): DomTruthMeasurement {
  return {
    lineCount,
    height: lineCount * lineHeightPx + paddingBlockPx * 2,
  };
}

function getReason(
  lineCountDelta: number,
  heightDelta: number,
): NonNullable<ComparePreparedTextToDomTruthResult["error"]>["reason"] {
  if (lineCountDelta !== 0 && heightDelta !== 0) {
    return "line-count-and-height-mismatch";
  }

  if (lineCountDelta !== 0) {
    return "line-count-mismatch";
  }

  return "height-mismatch";
}
