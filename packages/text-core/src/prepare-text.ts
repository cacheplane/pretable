import { segmentGraphemes } from "./graphemes";
import type {
  PrepareTextInput,
  PreparedText,
  PreparedTextToken,
} from "./types";

const DEFAULT_AVERAGE_CHAR_WIDTH = 7;

export function prepareText(input: PrepareTextInput): PreparedText {
  const text = input.text.replaceAll("\r\n", "\n");
  const graphemes = segmentGraphemes(text);
  const tokens = tokenizeText(text, graphemes);
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

/**
 * Every character of `text` is a newline, non-newline whitespace, or
 * non-whitespace, so the three alternatives *tile* the string: the matches are
 * contiguous, gapless, and in order. `tokenizeText` relies on that to walk a
 * code-unit cursor across them without asking for match indices.
 *
 * Hoisted out of `tokenizeText` so the pattern is compiled once rather than per
 * call. `String.prototype.match` on a global regex resets `lastIndex` to 0
 * before it iterates, so sharing this instance across calls is safe.
 */
const TOKEN_PATTERN = /\n|[^\S\n]+|[^\s]+/gu;

const ONLY_INLINE_WHITESPACE = /^[^\S\n]+$/u;

/**
 * Splits `text` into wrap tokens, taking each token's grapheme `length` from
 * the `graphemes` the caller has **already** segmented.
 *
 * This used to call `countGraphemes(value)` per token, which ran
 * `Intl.Segmenter` over every character a second time — the whole string once
 * as a string, then again token by token. On an S2 wrapped-text scroll that
 * duplicate pass alone was 156ms of a 748ms window (20.6%), against 35ms for
 * the whole-string segmentation it duplicated.
 *
 * The mapping is not a code-unit index arithmetic trick, because it cannot be:
 * `TOKEN_PATTERN` splits on code units while a grapheme is a *cluster* that may
 * span several. The two disagree only where a cluster straddles a token
 * boundary — which happens when whitespace carries a combining mark, e.g.
 * `" " + U+0301` is one cluster but two tokens. So a grapheme is counted
 * against **every** token its code-unit span overlaps. That is exactly what
 * per-token `countGraphemes` did: re-segmenting `" "` and `U+0301`
 * independently yielded 1 each. `__tests__/token-lengths.test.ts` pins the
 * equivalence across a corpus of ZWJ sequences, regional indicators, skin-tone
 * modifiers, and combining marks.
 */
function tokenizeText(text: string, graphemes: string[]): PreparedTextToken[] {
  const matches = text.match(TOKEN_PATTERN) ?? [];
  const tokens: PreparedTextToken[] = [];

  // `graphemeStart` is the code-unit offset at which `graphemes[graphemeIndex]`
  // begins; `tokenStart` is the offset at which the current token begins.
  let graphemeIndex = 0;
  let graphemeStart = 0;
  let tokenStart = 0;

  for (const value of matches) {
    const tokenEnd = tokenStart + value.length;
    let length = 0;

    while (graphemeIndex < graphemes.length && graphemeStart < tokenEnd) {
      const grapheme = graphemes[graphemeIndex];

      if (grapheme === undefined) {
        break;
      }

      length += 1;
      graphemeStart += grapheme.length;
      graphemeIndex += 1;
    }

    if (graphemeStart > tokenEnd) {
      // The last grapheme counted runs past this token's end, so it straddles
      // the boundary. Rewind one, leaving it to be counted against the next
      // token as well — the loop still advances, because the outer walk is
      // over `matches`.
      graphemeIndex -= 1;
      graphemeStart -= graphemes[graphemeIndex]?.length ?? 0;
    }

    tokenStart = tokenEnd;

    if (value === "\n") {
      // A newline has never carried a length; the cursor still had to move
      // past it above.
      tokens.push({ kind: "newline", value, length: 0 });
      continue;
    }

    tokens.push({
      kind: ONLY_INLINE_WHITESPACE.test(value) ? "space" : "word",
      value,
      length,
    });
  }

  return tokens;
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
