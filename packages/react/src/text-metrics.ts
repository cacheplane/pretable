/**
 * How wide is a character, really?
 *
 * `@pretable-internal/text-core` models a font as a single number — pixels per
 * character — and wraps with `charsPerLine = floor(width / averageCharWidth)`.
 * Nothing measured that number: `prepareText` infers it by pattern-matching the
 * font-key string ("mono" → 8, "condensed" → 6.5, "serif" → 7.25, else 7), and
 * the key the estimator passes is the literal "Pretable Estimate 14", which
 * matches none of them. Every grid, in every font, got 7.
 *
 * Measured against real rows, that predicts 3 lines where Chromium draws 2 —
 * 250px of the estimator's 299px total error on the homepage hero.
 *
 * This measures the real thing with `canvas.measureText`, which costs no layout
 * and no reflow: nothing is inserted into the document. One call per font per
 * session.
 *
 * A uniform average is still a uniform average. Text whose character mix is
 * unusual — all caps, digit-heavy, CJK, emoji — will still wrap differently
 * than predicted. Fixing that means per-string measurement, which is a
 * different design and was explicitly deferred rather than half-built here.
 */

const widthByFont = new Map<string, number | null>();

let segmenter: Intl.Segmenter | null = null;

function countGraphemes(text: string): number {
  // Code-unit length would halve the answer for emoji and mis-count combining
  // marks, and this number is a divisor.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // Stepped by hand rather than `for (const _ of ...)`: the loop binding is
    // unused, which lint rejects, and materialising an array to call `.length`
    // would allocate one object per grapheme just to count them.
    const graphemes = segmenter.segment(text)[Symbol.iterator]();
    let count = 0;
    while (graphemes.next().done !== true) count += 1;
    return count;
  }
  return [...text].length;
}

function getMeasuringContext(): CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(1, 1).getContext(
      "2d",
    ) as CanvasRenderingContext2D | null;
  }
  if (typeof document === "undefined") return null;
  return document.createElement("canvas").getContext("2d");
}

/**
 * Average advance width of `sampleText` in `font`, or `null` when it cannot be
 * measured. `font` is a CSS font shorthand, the same value a canvas context
 * takes.
 *
 * Null is the honest answer on the server and in jsdom, and callers must treat
 * it as "keep the existing guess" — an unmeasured grid has to estimate exactly
 * as it did before this existed.
 *
 * @internal
 */
export function measureAverageCharWidth(
  font: string,
  sampleText: string,
): number | null {
  const cached = widthByFont.get(font);
  if (cached !== undefined) return cached;

  const context = getMeasuringContext();
  const graphemes = countGraphemes(sampleText);
  if (context === null || graphemes === 0) {
    // Not cached: a later call may have a canvas (post-hydration) or real
    // sample text, and caching null here would pin the grid to the guess for
    // the rest of the session.
    return null;
  }

  context.font = font;
  const width = context.measureText(sampleText).width / graphemes;
  const resolved = Number.isFinite(width) && width > 0 ? width : null;
  if (resolved !== null) widthByFont.set(font, resolved);
  return resolved;
}

/** @internal */
export function resetTextMetricsCacheForTesting(): void {
  widthByFont.clear();
}
