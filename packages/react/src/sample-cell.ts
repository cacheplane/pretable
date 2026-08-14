/**
 * The one rendered cell every pre-layout metric is read off.
 *
 * Its own module rather than a private helper in either consumer, because both
 * of them need it and neither can import the other: `density.ts` already
 * imports `text-metrics.ts` for `invalidateGridTextMetrics`. A third copy of
 * this lookup is exactly what this file exists to prevent — the second copy,
 * an unscoped `document.querySelector("[data-pretable-cell]")` in
 * `resolveGridTextStyle`, is what made it worth extracting.
 */

/**
 * The cell to read a grid's typography and box off, or `null` when nothing
 * readable has rendered.
 *
 * A wrapped cell is preferred because wrapped text is the only content these
 * metrics are ever applied to.
 *
 * The row-select cell is excluded from the fallback, and that exclusion is
 * load-bearing rather than tidiness. It is synthetic and left-pinned, so it is
 * the FIRST `[data-pretable-cell]` in the document: a bare
 * `querySelector("[data-pretable-cell]")` lands on it. It reports the same 21px
 * as any other cell, which is why that went unnoticed — but its only child is
 * the 11px checkbox button, so once line height is resolved from the element
 * laying out the text sampling it would report 11px for the whole grid.
 * Verified in Chromium against the hero.
 *
 * Null when nothing readable has rendered. Callers keep the fallback, or their
 * last good value, rather than resolving half a box off nothing.
 *
 * @internal
 */
export function findSampleCell(): Element | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector('[data-pretable-cell][data-pretable-wrap="true"]') ??
    document.querySelector(
      "[data-pretable-cell]:not([data-pretable-row-select-cell])",
    )
  );
}
