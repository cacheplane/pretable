import type { ColumnPlan, RowMetricsReader } from "./types";

/**
 * Minimal scroll offsets that reveal a target row or column.
 *
 * These are the math half of keyboard scroll-into-view. `Element.scrollIntoView()`
 * cannot do this job: it needs a rendered DOM node (the whole point is that the
 * keyboard can move focus outside the virtualized window) and it has no idea a
 * sticky pinned column group is covering the target.
 *
 * ## Coordinate spaces (verified against @pretable/react, not assumed)
 *
 * **Vertical.** The scroller is a single element, `[data-pretable-scroll-viewport]`
 * (`pretable-surface.tsx:1331-1336`), with `overflow: auto` and no padding
 * (`styles.ts:14-25`). Its in-flow children, in order, are:
 *
 * 1. the aria-live region — `.pt-sr-only`, which is `position: absolute`
 *    (`packages/ui/src/grid.css:19-29`), so it is out of flow and contributes no
 *    height;
 * 2. `[data-pretable-header-row]` — `position: sticky; top: 0; height: headerHeight`
 *    (`styles.ts:27-40`), in flow, so it occupies exactly `headerHeight` at the top
 *    of the content box and stays pinned there for the whole scroll range (its
 *    containing block is the scroller itself);
 * 3. `[data-pretable-scroll-content]` — `position: relative; height: totalHeight`
 *    (`styles.ts:42-51`), inside which every row is `position: absolute; top`
 *    (`styles.ts:53-62`).
 *
 * So row `top` values are local to scroll-content, whose origin sits at
 * `headerHeight` in scroller coordinates. At `scrollTop = S` the scroller shows
 * `[S, S + viewportHeight]`, and the sticky header covers its first `headerHeight`
 * px. Subtracting the scroll-content origin, the *unoccluded* band in row
 * coordinates is exactly
 *
 *     [S, S + (viewportHeight - headerHeight)] = [S, S + bodyViewportHeight]
 *
 * which is the same `bodyViewportHeight` the surface already computes at
 * `pretable-surface.tsx:614` and feeds to the row planner. `viewportHeight` below
 * is therefore that body height, not the scroller's height.
 *
 * (Caveat, a few pixels at most. Two `@pretable/ui` borders sit outside this math,
 * because neither `getViewportStyle` nor `getHeaderRowStyle` sets `box-sizing`:
 *
 * - `[data-pretable-header-row]` carries a 1px `border-bottom` (`grid.css:41-44`).
 *   Under a `border-box` reset — which every app in this repo has — that border is
 *   inside `headerHeight` and the relationship above is exact; without one the
 *   header is 1px taller than `headerHeight`.
 * - `[data-pretable-scroll-viewport]` carries a 1px `border` on all four sides
 *   (`grid.css:32-38`). Here it is the reset that costs us: under `border-box` the
 *   declared `height` includes both borders, so the real `clientHeight` is
 *   `viewportHeight - 2` and the band is 2px smaller than assumed. Without a reset
 *   `height` is already the content box and this term is exact.
 *
 * The two therefore never bite at once, and the worst case is a band about 2px
 * larger than the truth. That errs toward revealing slightly LESS of the target,
 * not more: a band believed to be too tall produces a scroll offset a couple of
 * pixels short, leaving up to 2px of the target's trailing edge clipped. It does
 * not oscillate — the visibility test and the offset use the same `viewportHeight`,
 * so the next pass agrees the target is revealed and settles. `maxScrollTop` is
 * understated by the same 2px, which is why the effect is easiest to see on the
 * very last row. Sharpening this would mean measuring `clientHeight` on every pass
 * and giving up a prop-driven, allocation-free band for two pixels.)
 *
 * **Horizontal.** `planColumns` reports each column's `left` as a *content* offset,
 * with the scrollable run already shifted past the left-pinned group
 * (`column-plan.ts:141`). The pinned groups are sticky overlays on the viewport's
 * edges, so at `scrollLeft = SL` they cover content `[SL, SL + pinnedLeftWidth]` and
 * `[SL + viewportWidth - pinnedRightWidth, SL + viewportWidth]`, leaving the band
 *
 *     [SL + pinnedLeftWidth, SL + viewportWidth - pinnedRightWidth]
 *
 * in the same content coordinates the `left` values use.
 *
 * ## Return contract — three states, not two
 *
 * - a `number` is the offset to write;
 * - `null` means **decided: nothing to do**. The target is already revealed, or no
 *   offset could do better than the current one (a target larger than the band and
 *   already aligned, one clamped against the scroll extent, a sticky pinned column
 *   that is on screen at every offset). A caller that re-asserts until it gets
 *   `null` therefore terminates, and may mark the address permanently resolved.
 * - `undefined` means **not decidable on this pass**: the band is empty or
 *   inverted, so the question "which offset reveals the target" has no answer yet.
 *   The only causes are container geometry — an unmeasured scrollport (SSR, the
 *   first commit, a grid inside a `display: none` tab) or pinned groups at least as
 *   wide as the viewport.
 *
 * The `null` / `undefined` split exists for callers that latch. Collapsing them
 * (`== null`) latches an address on a pass that measured nothing, which disarms the
 * reveal for good: the geometry that caused it is transient, and the very next pass
 * — with a real width, or after a resize — would have produced a real offset. Both
 * causes are container-level, so they cannot coincide with a keypress (a grid the
 * user is typing into is measured), which is why retrying costs nothing on the hot
 * path.
 *
 * Returning nothing at all when nothing needs to move is also what keeps this
 * feature from fighting a user's own scrolling: the caller skips the DOM write
 * entirely rather than re-asserting an offset the user has deliberately left.
 */

/** @internal */
export interface ScrollTopToRevealInput {
  /** Built over *every* visible row, so any index is valid — rendered or not. */
  rowMetrics: RowMetricsReader;
  targetIndex: number;
  scrollTop: number;
  /** Unoccluded height: the scroller's height minus the sticky header. */
  viewportHeight: number;
}

/** @internal */
export interface ScrollLeftToRevealInput {
  /**
   * A plan covering *every* column, not the virtualization window — reaching a
   * column that is not rendered is the whole point of this function.
   * `planColumnLayout` (`@pretable-internal/renderer-dom`) is the one place
   * that builds such a plan, and it is the same one drag-to-reorder hit-tests
   * against. Handing in a windowed plan does not error: the off-window target
   * simply reads as an unknown column id and reveals nothing.
   */
  plan: ColumnPlan;
  targetColumnId: string;
  scrollLeft: number;
  viewportWidth: number;
}

/**
 * Minimal `scrollTop` that fully reveals the target row, `null` if it already is
 * (or if no offset would help), `undefined` if the band cannot be resolved yet.
 *
 * On the ArrowDown hot path — allocation-free, O(1).
 *
 * @internal
 */
export function scrollTopToReveal(
  input: ScrollTopToRevealInput,
): number | null | undefined {
  const { rowMetrics, targetIndex, scrollTop, viewportHeight } = input;

  if (targetIndex < 0 || targetIndex >= rowMetrics.rowCount) {
    return null;
  }

  // An empty band cannot reveal anything, and this is also what an unmeasured
  // viewport looks like (SSR, first commit). Writing a scroll offset from an
  // unmeasured viewport would only have to be undone — but the caller must not
  // latch on it either, hence `undefined` rather than `null`.
  if (viewportHeight <= 0) {
    return undefined;
  }

  const top = rowMetrics.getOffsetForIndex(targetIndex);
  const bottom = top + rowMetrics.getHeight(targetIndex);
  const maxScrollTop = Math.max(
    0,
    rowMetrics.getTotalHeight() - viewportHeight,
  );

  let next: number;

  if (top < scrollTop) {
    // Above the band: align the top edge. Checked first so a row taller than the
    // band that is already top-aligned stays put instead of ping-ponging.
    next = top;
  } else if (bottom > scrollTop + viewportHeight) {
    // Below the band: align the bottom edge — unless the row is taller than the
    // band, in which case that would push its first line off the top. `top` is
    // the smaller of the two exactly when the row does not fit.
    next = Math.min(bottom - viewportHeight, top);
  } else {
    return null;
  }

  next = Math.min(Math.max(next, 0), maxScrollTop);

  // Clamping (or an oversized row) can land on the offset we already have;
  // report that as "nothing to do" so the caller writes nothing.
  return next === scrollTop ? null : next;
}

/**
 * Minimal `scrollLeft` that fully reveals the target column clear of both pinned
 * groups, `null` if it already is (or if no offset would help), `undefined` if the
 * band cannot be resolved yet.
 *
 * Reads a plan the caller already built rather than building one — PR #203 fixed a
 * bug whose root cause was a second, drifted copy of column-bucketing math, and a
 * plan constructed in here would be exactly that copy again. The surface hands the
 * same `planColumnLayout` result to this and to drag-to-reorder hit-testing, so the
 * two cannot disagree about where a column sits. That is also why the undecidable
 * band is reported from in here rather than re-tested by the caller:
 * `pinnedLeftWidth` / `pinnedRightWidth` come off the same plan the offset does.
 *
 * Consuming the plan also makes this allocation-free. It used to rebuild the whole
 * plan per call — O(columns), several arrays plus an object each — which a held
 * ArrowRight across a 500-column grid paid on every keypress.
 *
 * @internal
 */
export function scrollLeftToReveal(
  input: ScrollLeftToRevealInput,
): number | null | undefined {
  const { plan, targetColumnId, scrollLeft, viewportWidth } = input;

  let target: (typeof plan.columns)[number] | undefined;

  for (const column of plan.columns) {
    if (column.id === targetColumnId) {
      target = column;
      break;
    }
  }

  // Decided, not undecidable: a column id the plan does not have is a caller bug
  // — either an id the engine never had, or a windowed plan handed in where an
  // unbounded one belongs. Neither is a transient measurement gap, and reporting
  // it as retryable would put the scan above on every subsequent effect pass —
  // including every ArrowDown — forever.
  if (!target) {
    return null;
  }

  // Pinned columns are sticky overlays: they are on screen at every scroll offset,
  // and `planColumns` never virtualizes them away.
  if (target.pinned) {
    return null;
  }

  const { pinnedLeftWidth, pinnedRightWidth, totalWidth } = plan;
  const bandWidth = viewportWidth - pinnedLeftWidth - pinnedRightWidth;

  // Pinned groups at least as wide as the viewport leave an empty or inverted
  // band: every scrollable column is covered at every offset, so any number we
  // returned would be noise. Also covers viewportWidth <= 0 (unmeasured viewport).
  // Both are container geometry that a resize or a first measurement can change,
  // so this is `undefined` — the caller must retry, not latch.
  if (bandWidth <= 0) {
    return undefined;
  }

  const bandStart = scrollLeft + pinnedLeftWidth;
  const bandEnd = scrollLeft + viewportWidth - pinnedRightWidth;
  const left = target.left;
  const right = left + target.width;
  const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);

  let next: number;

  if (left < bandStart) {
    next = left - pinnedLeftWidth;
  } else if (right > bandEnd) {
    // Same tie-break as the vertical case: a column wider than the band aligns to
    // the band's left edge so its start is readable.
    next = Math.min(
      right - viewportWidth + pinnedRightWidth,
      left - pinnedLeftWidth,
    );
  } else {
    return null;
  }

  next = Math.min(Math.max(next, 0), maxScrollLeft);

  return next === scrollLeft ? null : next;
}
