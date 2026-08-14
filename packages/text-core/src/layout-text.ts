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

/**
 * How `pre-wrap` treats preserved whitespace — measured, not assumed.
 *
 * Playwright probe, `font: 20px monospace`, `line-height: 20px`, in Chromium
 * 151.0.7922.34 (advance 12.003px), WebKit 26.5 (12.002px) and Firefox 153.0
 * (12.033px), with line boxes read back per grapheme through
 * `Range.getClientRects()`:
 *
 * - **Runs are preserved.** Inline `"a  a"` measures 48.02 / 48.01 / 48.13px
 *   under `pre-wrap` against 36.02 / 36.01 / 36.10px under `normal` — the
 *   second space survives only under `pre-wrap`. Leading `"  a"` is 3 advances
 *   wide under `pre-wrap` and 1 under `normal`.
 * - **`\n` breaks.** `"a\nb"` in a 400px box is 2 lines under `pre-wrap` and
 *   1 under `normal`, in all three.
 * - **A space run never moves to the next line and never causes the break
 *   itself — it hangs.** `"aa      aa"` in a 2-advance box lays out as
 *   `"aa      "` (line-box right edge 96.03px, hanging 72px past a 24.01px
 *   container) then `"aa"`: 2 lines, at every container width from 2 to 9
 *   advances, in all three. A model that pushed the unfitting run down to the
 *   next line would report 3.
 * - **The hanging run still advances the pen for what follows.** That same
 *   string first fits on one line at 10 advances, not the 4 it would need if
 *   preserved spaces were free.
 *
 * So: charge every space token to the line it starts on, and let the *word*
 * that follows make the break decision. That is the rule implemented below.
 *
 * Under `white-space: normal` — this module's `wrap` — the opposite rule
 * applies, and it was read from the same probe: a run of whitespace
 * **collapses to a single space**. Inline `"a  a"` measures 36.02 / 36.01 /
 * 36.10px, i.e. 3 advances, against the 4 it measures under `pre-wrap`. So
 * `wrap` charges a space token one grapheme however long the run is.
 *
 * The collapsed charge is the run's own per-grapheme advance — its measured
 * width divided by its grapheme count — rather than the width of a literal
 * `" "`. That is exactly one space for the all-space runs that are almost all
 * of them, and it is the only definition the two paths can both compute: the
 * average path knows nothing of a run's contents beyond its length, so any
 * rule that distinguished a tab from a space would put the paths out of step.
 * A run of tabs is therefore charged one tab rather than the one space a
 * browser would collapse it to — closer than charging the whole run, and the
 * residual is a whitespace-mixing case the average path cannot see at all.
 *
 * `\n` is a token of its own here and keeps breaking the line under `wrap`.
 * A browser under `white-space: normal` would collapse it into the
 * surrounding whitespace and not break — but every caller of this module
 * feeds it cell values that are rendered with newlines preserved, so the
 * break is the deliberate existing model and is left alone.
 *
 * The engines agreed everywhere except `"  aa aa"` at a container of exactly
 * 4 advances: Chromium says 3 lines, WebKit and Firefox say 2. That is
 * subpixel accounting, not a rule difference — Chromium measures a space
 * fractionally wider than a letter (`"  a"` 36.031px against `"a a"`
 * 36.016px), so `"  aa"` overflows a box sized to 4 letter-advances by
 * ~0.015px and takes the break opportunity after the leading run. At 4.5
 * advances Chromium reports 2 like the others. Exact arithmetic — which is
 * what this module does — gives the majority answer.
 */

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
  const preserveSpaces = wrapMode === "pre-wrap";

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
      preserveSpaces,
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
  const { lineCount, maxLineChars } = wrapTokens(
    prepared.tokens,
    charsPerLine,
    preserveSpaces,
  );

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
  preserveSpaces: boolean,
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
      if (preserveSpaces) {
        // Preserved whitespace is charged to the line it starts on and hangs
        // past the edge rather than breaking or moving down — see
        // the pre-wrap probe note near the top of this file.
        currentLineChars += token.length;
        continue;
      }

      if (currentLineChars === 0) {
        continue;
      }

      // Collapsed: one grapheme, however long the run — see the probe note at
      // the top of this file.
      if (currentLineChars + 1 <= charsPerLine) {
        currentLineChars += 1;
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
  preserveSpaces: boolean,
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
      if (preserveSpaces) {
        currentLineWidth += tokenWidth;
        continue;
      }

      if (currentLineWidth === 0) {
        continue;
      }

      // The pixel twin of the character path's collapse: the run's own
      // per-grapheme advance, which is one space's for an all-space run.
      const collapsedWidth = tokenWidth / Math.max(1, token.length);

      if (fits(currentLineWidth + collapsedWidth)) {
        currentLineWidth += collapsedWidth;
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

    return (
      (graphemes % graphemesPerLine || graphemesPerLine) * perGraphemeWidth
    );
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
