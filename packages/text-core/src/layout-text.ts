import type {
  LayoutPreparedTextOptions,
  PreparedText,
  PreparedTextLayout,
  PreparedTextToken,
} from "./types";

const DEFAULT_LINE_HEIGHT_PX = 20;

/**
 * Slack, in px, allowed when comparing accumulated widths against the
 * available width.
 *
 * The pixel path sums floating-point advances, so a run that fits exactly can
 * land a few ULPs over the line. A tolerance far below one device subpixel
 * costs nothing physically and keeps the sum from wrapping a line early.
 */
const WIDTH_EPSILON_PX = 1e-6;

export function layoutPreparedText(
  prepared: PreparedText,
  width: number,
  options: LayoutPreparedTextOptions = {},
): PreparedTextLayout {
  const wrapMode = options.wrapMode ?? "wrap";
  const lineHeightPx = options.lineHeightPx ?? DEFAULT_LINE_HEIGHT_PX;
  const paddingBlockPx = options.paddingBlockPx ?? 0;
  const explicitLineCount = countExplicitLines(prepared.tokens);
  const tokenWidthsPx = resolveTokenWidths(prepared);

  if (wrapMode === "nowrap") {
    const intrinsicWidth =
      tokenWidthsPx === null
        ? prepared.graphemeCount * prepared.averageCharWidth
        : sum(tokenWidthsPx);

    return buildLayout({
      lineCount: explicitLineCount,
      lineHeightPx,
      paddingBlockPx,
      measuredWidth: intrinsicWidth,
      overflowX: intrinsicWidth > width,
    });
  }

  if (tokenWidthsPx !== null) {
    // Negative and zero widths are clamped rather than divided by: an
    // available width of zero means every token starts its own line, which is
    // what the character path's `Math.max(1, ...)` produces too.
    const availableWidth = Math.max(0, width);
    const { lineCount, maxLineWidth } = wrapTokensByWidth(
      prepared.tokens,
      tokenWidthsPx,
      availableWidth,
    );

    return buildLayout({
      lineCount,
      lineHeightPx,
      paddingBlockPx,
      measuredWidth: Math.min(availableWidth, maxLineWidth),
      overflowX: false,
    });
  }

  const charsPerLine = Math.max(
    1,
    Math.floor(width / prepared.averageCharWidth),
  );
  const { lineCount, maxLineChars } = wrapTokens(prepared.tokens, charsPerLine);

  return buildLayout({
    lineCount,
    lineHeightPx,
    paddingBlockPx,
    measuredWidth: Math.min(width, maxLineChars * prepared.averageCharWidth),
    overflowX: false,
  });
}

/**
 * Returns per-token widths only when they are usable — present and aligned
 * with `tokens`. Anything else falls back to the average-width path rather
 * than reading past the end of the array.
 */
function resolveTokenWidths(prepared: PreparedText): number[] | null {
  const widths = prepared.tokenWidthsPx;

  if (widths === undefined || widths.length !== prepared.tokens.length) {
    return null;
  }

  return widths;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function countExplicitLines(tokens: PreparedTextToken[]): number {
  return tokens.reduce(
    (count, token) => count + (token.kind === "newline" ? 1 : 0),
    1,
  );
}

function wrapTokens(
  tokens: PreparedTextToken[],
  charsPerLine: number,
): { lineCount: number; maxLineChars: number } {
  let lineCount = 1;
  let currentLineChars = 0;
  let maxLineChars = 0;

  const pushLine = () => {
    maxLineChars = Math.max(maxLineChars, currentLineChars);
    lineCount += 1;
    currentLineChars = 0;
  };

  for (const token of tokens) {
    if (token.kind === "newline") {
      maxLineChars = Math.max(maxLineChars, currentLineChars);
      lineCount += 1;
      currentLineChars = 0;
      continue;
    }

    if (token.kind === "space") {
      if (currentLineChars === 0) {
        continue;
      }

      if (currentLineChars + token.length <= charsPerLine) {
        currentLineChars += token.length;
      } else {
        pushLine();
      }

      continue;
    }

    placeWord(token.length);
  }

  maxLineChars = Math.max(maxLineChars, currentLineChars);

  return { lineCount, maxLineChars };

  function placeWord(wordLength: number) {
    if (currentLineChars === 0) {
      currentLineChars = placeAtLineStart(wordLength);
      return;
    }

    if (currentLineChars + wordLength <= charsPerLine) {
      currentLineChars += wordLength;
      return;
    }

    pushLine();
    currentLineChars = placeAtLineStart(wordLength);
  }

  function placeAtLineStart(wordLength: number): number {
    if (wordLength <= charsPerLine) {
      return wordLength;
    }

    const wrappedLines = Math.ceil(wordLength / charsPerLine);
    lineCount += wrappedLines - 1;
    maxLineChars = Math.max(maxLineChars, charsPerLine);
    return wordLength % charsPerLine || charsPerLine;
  }
}

/**
 * The pixel twin of `wrapTokens`: same greedy token-at-a-time algorithm, with
 * accumulated advance widths in place of grapheme counts.
 *
 * Kept as a separate function rather than a parameterised one because the two
 * differ in how they split an over-wide word — see `placeAtLineStart`.
 */
function wrapTokensByWidth(
  tokens: PreparedTextToken[],
  widths: number[],
  availableWidth: number,
): { lineCount: number; maxLineWidth: number } {
  let lineCount = 1;
  let currentLineWidth = 0;
  let maxLineWidth = 0;

  const pushLine = () => {
    maxLineWidth = Math.max(maxLineWidth, currentLineWidth);
    lineCount += 1;
    currentLineWidth = 0;
  };

  for (const [index, token] of tokens.entries()) {
    const tokenWidth = widths[index] ?? 0;

    if (token.kind === "newline") {
      maxLineWidth = Math.max(maxLineWidth, currentLineWidth);
      lineCount += 1;
      currentLineWidth = 0;
      continue;
    }

    if (token.kind === "space") {
      if (currentLineWidth === 0) {
        continue;
      }

      if (fits(currentLineWidth + tokenWidth)) {
        currentLineWidth += tokenWidth;
      } else {
        pushLine();
      }

      continue;
    }

    placeWord(tokenWidth, token.length);
  }

  maxLineWidth = Math.max(maxLineWidth, currentLineWidth);

  return { lineCount, maxLineWidth };

  function fits(candidateWidth: number): boolean {
    return candidateWidth <= availableWidth + WIDTH_EPSILON_PX;
  }

  function placeWord(wordWidth: number, graphemeCount: number) {
    if (currentLineWidth === 0) {
      currentLineWidth = placeAtLineStart(wordWidth, graphemeCount);
      return;
    }

    if (fits(currentLineWidth + wordWidth)) {
      currentLineWidth += wordWidth;
      return;
    }

    pushLine();
    currentLineWidth = placeAtLineStart(wordWidth, graphemeCount);
  }

  function placeAtLineStart(wordWidth: number, graphemeCount: number): number {
    if (fits(wordWidth)) {
      return wordWidth;
    }

    // The word is wider than the line and must be broken inside itself. One
    // token-level measurement says nothing about where its graphemes fall, so
    // the split assumes the word's own average density — which is the best
    // available answer, and is exact for a uniform-width font.
    const graphemes = Math.max(1, graphemeCount);
    const perGraphemeWidth = wordWidth / graphemes;
    const graphemesPerLine = Math.max(
      1,
      Math.floor(availableWidth / perGraphemeWidth + WIDTH_EPSILON_PX),
    );
    const wrappedLines = Math.ceil(graphemes / graphemesPerLine);

    lineCount += wrappedLines - 1;
    maxLineWidth = Math.max(maxLineWidth, graphemesPerLine * perGraphemeWidth);

    return (graphemes % graphemesPerLine || graphemesPerLine) * perGraphemeWidth;
  }
}

function buildLayout(input: {
  lineCount: number;
  lineHeightPx: number;
  paddingBlockPx: number;
  measuredWidth: number;
  overflowX: boolean;
}): PreparedTextLayout {
  return {
    lineCount: input.lineCount,
    height: input.lineCount * input.lineHeightPx + input.paddingBlockPx * 2,
    measuredWidth: input.measuredWidth,
    overflowX: input.overflowX,
  };
}
