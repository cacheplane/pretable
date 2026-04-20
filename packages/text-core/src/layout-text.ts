import type {
  LayoutPreparedTextOptions,
  PreparedText,
  PreparedTextLayout,
  PreparedTextToken,
} from "./types";

const DEFAULT_LINE_HEIGHT_PX = 20;

export function layoutPreparedText(
  prepared: PreparedText,
  width: number,
  options: LayoutPreparedTextOptions = {},
): PreparedTextLayout {
  const wrapMode = options.wrapMode ?? "wrap";
  const lineHeightPx = options.lineHeightPx ?? DEFAULT_LINE_HEIGHT_PX;
  const paddingBlockPx = options.paddingBlockPx ?? 0;
  const explicitLineCount = countExplicitLines(prepared.tokens);

  if (wrapMode === "nowrap") {
    return buildLayout({
      lineCount: explicitLineCount,
      lineHeightPx,
      paddingBlockPx,
      measuredWidth: prepared.graphemeCount * prepared.averageCharWidth,
      overflowX: prepared.graphemeCount * prepared.averageCharWidth > width,
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
