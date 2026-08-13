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

// One measuring context per session, once a host has been asked. Recreating a
// canvas per call is wasted work in a browser and, in jsdom — where `getContext`
// is unimplemented — a "Not implemented" console error on every estimate.
//
// `undefined` means "not yet asked". A resolved `null` is only remembered when a
// host was actually present to answer: an engine that has no 2d canvas will not
// grow one mid-session, but a server render has no `document` at all, and
// remembering that would strand the grid on the guess after hydration.
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

// The grid's own width, once something has rendered to measure it off. Held
// here rather than derived per call so the DOM read below happens once a
// session; see the staleness note inside the function.
let gridCharWidth: number | null = null;

/**
 * The average character width of the font a grid is actually drawing in, read
 * off a rendered cell, or `null` when no cell has rendered yet.
 *
 * Null before the first paint is the correct answer, not a failure: the
 * estimator then keeps the width it guessed before this existed, and the next
 * call — after cells exist — measures for real. Nothing is cached on the null
 * path, so the pre-render miss does not become permanent.
 *
 * A wrapped cell is preferred because wrapped text is the only thing the
 * estimator's character width is ever used on.
 *
 * @internal
 */
export function getGridAverageCharWidth(): number | null {
  // The controller asks for this on EVERY row estimate — deliberately, because
  // the font only becomes measurable once a cell has rendered. So both caches
  // below are load-bearing, not micro-optimisation: without them a scenario's
  // worth of estimates costs a `querySelector` plus a `getComputedStyle` each,
  // which measured at 679ms of a 1 187ms bench-app test under jsdom.
  //
  // Staleness, stated rather than left to be discovered: once a width has been
  // measured, a later theme or font swap is NOT re-measured, so a grid that
  // changes fonts mid-session keeps estimating in the old one. Same class as
  // the calibration floor's staleness documented in `row-layout-controller.ts`,
  // and the same reasoning — the alternative is a DOM read per estimate.
  if (gridCharWidth !== null) return gridCharWidth;
  // A host either has a 2d canvas or it does not; unlike a width, that answer
  // cannot turn from "no" to "yes" mid-session, so it is safe to remember. The
  // server is a separate realm from the browser that later hydrates, so a
  // server-side miss cannot poison a client. Asking first means jsdom and any
  // canvas-less engine never pay for the DOM read whose result they cannot use.
  if (getMeasuringContext() === null) return null;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return null;
  const cell =
    document.querySelector('[data-pretable-cell][data-pretable-wrap="true"]') ??
    document.querySelector("[data-pretable-cell]");
  if (cell === null) return null;
  const font = getComputedStyle(cell).font;
  // jsdom and any engine that declines to serialise the shorthand return "".
  // Measuring an empty font would report the canvas default, not the grid's.
  if (typeof font !== "string" || font.trim() === "") return null;
  const ownText = (cell.textContent ?? "").trim();
  const measured = measureAverageCharWidth(
    font,
    ownText === "" ? FALLBACK_SAMPLE_TEXT : ownText,
  );
  // Null stays uncached: no cell had rendered yet, or the one that had carried
  // nothing measurable. Either can change on the next call, and pinning it here
  // would strand the grid on the pre-measurement guess.
  if (measured !== null) gridCharWidth = measured;
  return measured;
}

/** @internal */
export function resetTextMetricsCacheForTesting(): void {
  widthByFont.clear();
  measuringContext = undefined;
  gridCharWidth = null;
}
