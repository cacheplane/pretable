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
 * than predicted. That is what `measureSegment` below now fixes: the same
 * canvas context measures each token of a string, `text-core` wraps by
 * accumulated pixel width, and the average is only the fallback for hosts that
 * cannot measure at all.
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

// One measuring context per session, once a host has been asked. Recreating a
// canvas per call is wasted work in a browser and, in jsdom — where `getContext`
// is unimplemented — a "Not implemented" console error on every estimate.
//
// `undefined` means "not yet asked". A resolved `null` is only remembered when a
// host was actually present to answer: an engine that has no 2d canvas will not
// grow one mid-session, but a server render has no `document` at all, and
// remembering that would strand the grid on the guess after hydration.
//
// The OffscreenCanvas-then-detached-canvas probe below is the conventional way
// to reach a measuring context, and @chenglou/pretext — acknowledged in LICENSE
// for the segment-measurement design this file implements — does the same two
// checks in the same order. Noted rather than left for a reader to wonder about.
// The behaviour diverges where it matters: pretext throws when neither is
// available, and this returns null so an unmeasurable host keeps the average
// width instead of losing its estimates.
let measuringContext: CanvasRenderingContext2D | null | undefined;

function getMeasuringContext(): CanvasRenderingContext2D | null {
  if (measuringContext !== undefined) return measuringContext;
  let resolved: CanvasRenderingContext2D | null = null;
  if (typeof OffscreenCanvas !== "undefined") {
    resolved = new OffscreenCanvas(1, 1).getContext(
      "2d",
    ) as CanvasRenderingContext2D | null;
  } else if (typeof document !== "undefined") {
    resolved = document.createElement("canvas").getContext("2d");
  } else {
    return null;
  }
  measuringContext = resolved;
  return resolved;
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

/**
 * A fixed sample for the case where a cell has rendered but carries no text.
 * Only a fallback: real cell content is preferred, because average character
 * width is content-dependent and a corpus string bakes in English-prose bias.
 */
const FALLBACK_SAMPLE_TEXT =
  "The quick brown fox jumps over the lazy dog 0123456789";

/**
 * Everything about a grid cell's text that comes from one `getComputedStyle`:
 * the font the canvas measures in, the CSS letter spacing `text-core` charges
 * per grapheme, and the cell's own text to average over.
 */
interface GridTextStyle {
  readonly font: string;
  readonly letterSpacingPx: number;
  readonly sampleText: string;
}

// The grid's own text style, once something has rendered to read it off. Held
// here rather than derived per call so the DOM read below happens once per
// theme; see the note inside `resolveGridTextStyle`.
let gridTextStyle: GridTextStyle | null = null;
let gridTextStyleStale = false;
// The grid's own width, once something has rendered to measure it off.
let gridCharWidth: number | null = null;
// Set when the theme store sees `<html>` change. Not a reset: the last good
// width is kept until a new one has actually been measured, so a swap cannot
// drop the grid back to the pre-measurement guess.
let gridCharWidthStale = false;

/**
 * Mark the measured grid text metrics — character width, font, letter spacing,
 * and with them the segment measurer — as needing a re-read, because the theme
 * or density on `<html>` changed and the font may have changed with it.
 *
 * Called from `density.ts`'s theme store — the same store `useResolvedHeights`
 * re-renders through — so the row box and everything in this file, which
 * describe one theme, always invalidate on one signal. Deliberately NOT a cache
 * clear: the re-read happens on the next estimate, so the DOM cost is one read
 * per theme change rather than one per estimate.
 *
 * The per-segment widths are NOT dropped, because they are keyed by font: a
 * swap that changes the font simply measures under a new key, and one that does
 * not change it would have re-measured identical numbers.
 *
 * @internal
 */
export function invalidateGridTextMetrics(): void {
  gridCharWidthStale = true;
  gridTextStyleStale = true;
}

/**
 * The computed text style of a rendered grid cell, or `null` when nothing has
 * rendered yet.
 *
 * The controller asks for the things built on this on EVERY row estimate —
 * deliberately, because the font only becomes measurable once a cell has
 * rendered. So this cache is load-bearing, not micro-optimisation: without it a
 * scenario's worth of estimates costs a `querySelector` plus a
 * `getComputedStyle` each, which measured at 679ms of a 1 187ms bench-app test
 * under jsdom. One read per theme change, none per estimate — and one read for
 * all three consumers below, not one each.
 *
 * A wrapped cell is preferred because wrapped text is the only content these
 * metrics are ever applied to.
 */
function resolveGridTextStyle(): GridTextStyle | null {
  if (gridTextStyle !== null && !gridTextStyleStale) return gridTextStyle;
  // A host either has a 2d canvas or it does not; unlike a width, that answer
  // cannot turn from "no" to "yes" mid-session, so it is safe to remember. The
  // server is a separate realm from the browser that later hydrates, so a
  // server-side miss cannot poison a client. Asking first means jsdom and any
  // canvas-less engine never pay for the DOM read whose result they cannot use.
  if (getMeasuringContext() === null) return gridTextStyle;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return gridTextStyle;
  const cell =
    document.querySelector('[data-pretable-cell][data-pretable-wrap="true"]') ??
    document.querySelector("[data-pretable-cell]");
  if (cell === null) return gridTextStyle;
  const computed = getComputedStyle(cell);
  const font = computed.font;
  // jsdom and any engine that declines to serialise the shorthand return "".
  // Measuring an empty font would report the canvas default, not the grid's.
  if (typeof font !== "string" || font.trim() === "") return gridTextStyle;
  gridTextStyle = {
    font,
    letterSpacingPx: parseLetterSpacingPx(computed.letterSpacing),
    sampleText: (cell.textContent ?? "").trim(),
  };
  gridTextStyleStale = false;
  return gridTextStyle;
}

/**
 * CSS `letter-spacing` in px. `normal`, an empty string and anything that is
 * not a px length all mean "no extra advance", which is what every grid got
 * before this was read at all.
 */
function parseLetterSpacingPx(value: string | undefined): number {
  if (typeof value !== "string") return 0;
  const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
  if (match === null) return 0;
  const parsed = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The average character width of the font a grid is actually drawing in, read
 * off a rendered cell, or `null` when no cell has rendered yet.
 *
 * Null before the first paint is the correct answer, not a failure: the
 * estimator then keeps the width it guessed before this existed, and the next
 * call — after cells exist — measures for real. Nothing is cached on the null
 * path, so the pre-render miss does not become permanent.
 *
 * Still supplied alongside the segment measurer rather than replaced by it:
 * `text-core` falls back to it for any input the measured path cannot answer,
 * and a host with a canvas but no rendered cell has neither.
 *
 * @internal
 */
export function getGridAverageCharWidth(): number | null {
  // Every early return past this point keeps the last good width rather than
  // falling back to null, so a swap observed before the new cells exist cannot
  // strand the grid on the pre-measurement guess.
  if (gridCharWidth !== null && !gridCharWidthStale) return gridCharWidth;
  const style = resolveGridTextStyle();
  if (style === null) return gridCharWidth;
  const measured = measureAverageCharWidth(
    style.font,
    style.sampleText === "" ? FALLBACK_SAMPLE_TEXT : style.sampleText,
  );
  // Null stays uncached: no cell had rendered yet, or the one that had carried
  // nothing measurable. Either can change on the next call, and pinning it here
  // would strand the grid on the pre-measurement guess. The stale flag likewise
  // stays set until a real measurement replaces the old one.
  if (measured === null) return gridCharWidth;
  gridCharWidth = measured;
  gridCharWidthStale = false;
  return measured;
}

/**
 * The grid's CSS `letter-spacing` in px, or `null` when no cell has rendered.
 *
 * `text-core` charges it to every grapheme — the last of a line included, which
 * is what browsers do — on both the measured and the average path. Null keeps
 * both paths exactly where they were before it was read.
 *
 * @internal
 */
export function getGridLetterSpacingPx(): number | null {
  return resolveGridTextStyle()?.letterSpacingPx ?? null;
}

// Per-segment advance widths, keyed by font and then by segment. Two bounds,
// because grid text is unbounded in principle and this sits on the estimate
// path:
//
//   - `MAX_SEGMENTS_PER_FONT` caps one font's vocabulary. A grid's working set
//     is its visible tokens; 4096 distinct ones is far more than any viewport
//     holds, so the cap is reached only by a session that has scrolled through
//     a great deal of distinct text — at which point the oldest entries are
//     the least likely to be asked for again.
//   - `MAX_MEASURED_FONTS` caps how many fonts are remembered at once. Fonts
//     change only with the theme, so 8 covers switching between every shipped
//     theme and density without evicting anything.
//
// Eviction is by insertion order (a `Map` preserves it) rather than by LRU:
// keeping recency would mean a delete plus a set on every cache HIT, which is
// the hot path this cache exists to make cheap. Dropping the oldest entries
// costs at worst a re-measurement of text that is on screen again.
const MAX_SEGMENTS_PER_FONT = 4096;
const MAX_MEASURED_FONTS = 8;
const segmentWidthsByFont = new Map<string, Map<string, number>>();
const segmentMeasurerByFont = new Map<string, (segment: string) => number>();

/**
 * Advance width of `segment` in `font`, in px, measured on the shared canvas
 * context and cached by `(segment, font)`.
 *
 * Returns `null` on a host that cannot measure, exactly as
 * {@link measureAverageCharWidth} does, so callers can fall back to the
 * average-width path rather than wrap by a fabricated number.
 *
 * @internal
 */
export function measureSegment(segment: string, font: string): number | null {
  let widths = segmentWidthsByFont.get(font);
  if (widths !== undefined) {
    const cached = widths.get(segment);
    if (cached !== undefined) return cached;
  }

  const context = getMeasuringContext();
  if (context === null) return null;
  context.font = font;
  const width = context.measureText(segment).width;
  if (!Number.isFinite(width)) return null;

  if (widths === undefined) {
    if (segmentWidthsByFont.size >= MAX_MEASURED_FONTS) {
      const oldest = segmentWidthsByFont.keys().next();
      if (oldest.done !== true) {
        segmentWidthsByFont.delete(oldest.value);
        segmentMeasurerByFont.delete(oldest.value);
      }
    }
    widths = new Map<string, number>();
    segmentWidthsByFont.set(font, widths);
  } else if (widths.size >= MAX_SEGMENTS_PER_FONT) {
    const oldest = widths.keys().next();
    if (oldest.done !== true) widths.delete(oldest.value);
  }
  widths.set(segment, width);
  return width;
}

/**
 * A segment measurer bound to the font the grid is drawing in, or `null` when
 * nothing can be measured yet (server rendering, no canvas, no cell painted).
 *
 * The returned function's IDENTITY is part of the estimate memo key, so one
 * font must always yield the same function object — a getter that closed over
 * the font afresh per call would miss the memo on every row and re-run text
 * layout for all of them. It changes only when the font does, which is exactly
 * when memoized estimates have to be thrown away.
 *
 * @internal
 */
export function getGridSegmentMeasurer(): ((segment: string) => number) | null {
  const style = resolveGridTextStyle();
  if (style === null) return null;
  const { font } = style;
  let measurer = segmentMeasurerByFont.get(font);
  if (measurer === undefined) {
    // `text-core` asks for a number, not a maybe-number. Reaching the fallback
    // means the host lost its canvas mid-session, which it cannot; measuring 0
    // there would silently claim every token is zero-wide, so the average path
    // is the only honest answer and the caller has already chosen it by the
    // time this measurer exists.
    measurer = (segment: string) => measureSegment(segment, font) ?? 0;
    segmentMeasurerByFont.set(font, measurer);
  }
  return measurer;
}

/** @internal */
export function resetTextMetricsCacheForTesting(): void {
  widthByFont.clear();
  measuringContext = undefined;
  gridCharWidth = null;
  gridCharWidthStale = false;
  gridTextStyle = null;
  gridTextStyleStale = false;
  segmentWidthsByFont.clear();
  segmentMeasurerByFont.clear();
}
