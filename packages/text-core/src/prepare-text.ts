import { countGraphemes, segmentGraphemes } from "./graphemes";
import type {
  PrepareTextInput,
  PreparedText,
  PreparedTextToken,
} from "./types";

const DEFAULT_AVERAGE_CHAR_WIDTH = 7;

export function prepareText(input: PrepareTextInput): PreparedText {
  const text = input.text.replaceAll("\r\n", "\n");
  const graphemes = segmentGraphemes(text);
  const tokens = tokenizeText(text);
  const letterSpacingPx = input.letterSpacingPx ?? 0;

  const prepared: PreparedText = {
    text,
    fontKey: input.fontKey,
    graphemeCount: graphemes.length,
    breakpoints: collectBreakpoints(graphemes),
    // Letter spacing is folded in here rather than threaded through
    // `layoutPreparedText`, so that both paths carry it in the one place each
    // already reads. See `PrepareTextInput.letterSpacingPx` for the browser
    // measurement behind charging it to every grapheme.
    averageCharWidth:
      (input.averageCharWidth ?? estimateAverageCharWidth(input.fontKey)) +
      letterSpacingPx,
    tokens,
  };

  if (input.measureSegment !== undefined) {
    prepared.tokenWidthsPx = measureTokens(
      tokens,
      input.measureSegment,
      letterSpacingPx,
    );
  }

  return prepared;
}

/**
 * Measures every token, calling `measureSegment` once per *distinct* token
 * value. Tokens repeat heavily inside a single string — and far more so across
 * grid rows — so the caller is expected to cache too, but this call must not
 * pay for the same segment twice on its own.
 */
function measureTokens(
  tokens: PreparedTextToken[],
  measureSegment: (segment: string) => number,
  letterSpacingPx: number,
): number[] {
  const measured = new Map<string, number>();

  return tokens.map((token) => {
    // A newline has no advance width, and asking a canvas to measure one
    // yields a font-dependent nonsense value.
    if (token.kind === "newline") {
      return 0;
    }

    // The measurer is asked for the unspaced advance and the spacing is added
    // on top, so the cache stays keyed on what the font actually does. Every
    // grapheme is charged, the token's last included.
    let width = measured.get(token.value);

    if (width === undefined) {
      width = measureSegment(token.value);
      measured.set(token.value, width);
    }

    return width + letterSpacingPx * token.length;
  });
}

function collectBreakpoints(graphemes: string[]): number[] {
  const breakpoints: number[] = [];

  for (let index = 0; index < graphemes.length; index += 1) {
    const value = graphemes[index];

    if (value === undefined) {
      continue;
    }

    if (/\s/u.test(value) || value === "-" || value === "/" || value === "_") {
      breakpoints.push(index + 1);
    }
  }

  return breakpoints;
}

function tokenizeText(text: string): PreparedTextToken[] {
  const matches = text.match(/\n|[^\S\n]+|[^\s]+/gu) ?? [];

  return matches.map((value) => {
    if (value === "\n") {
      return { kind: "newline", value, length: 0 };
    }

    if (/^[^\S\n]+$/u.test(value)) {
      return { kind: "space", value, length: countGraphemes(value) };
    }

    return { kind: "word", value, length: countGraphemes(value) };
  });
}

function estimateAverageCharWidth(fontKey: string): number {
  const normalized = fontKey.toLowerCase();

  if (normalized.includes("mono")) {
    return 8;
  }

  if (normalized.includes("condensed")) {
    return 6.5;
  }

  if (normalized.includes("serif")) {
    return 7.25;
  }

  return DEFAULT_AVERAGE_CHAR_WIDTH;
}
