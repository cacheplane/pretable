import { planColumns } from "./column-plan";
import type { PlanColumnsColumnInput, RowMetricsReader } from "./types";

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
 * (`pretable-surface.tsx:1072`), with `overflow: auto` and no padding
 * (`styles.ts:14-25`). Its in-flow children, in order, are:
 *
 * 1. the aria-live region — `.pt-sr-only`, which is `position: absolute`
 *    (`packages/ui/src/grid.css:19`), so it is out of flow and contributes no
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
 * `pretable-surface.tsx:591` and feeds to the row planner. `viewportHeight` below
 * is therefore that body height, not the scroller's height.
 *
 * (Caveat, sub-pixel only: `[data-pretable-header-row]` also carries a 1px
 * `border-bottom` from `@pretable/ui`'s grid.css, and `getHeaderRowStyle` does not
 * set `box-sizing`. Under a `border-box` reset — which every app in this repo has —
 * the border is inside `headerHeight` and the relationship above is exact; without
 * one the header is 1px taller than `headerHeight`. A 1px error is not worth
 * complicating this math for, and it biases toward revealing slightly more of the
 * target, not less.)
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
 * Both functions return `null` when nothing needs to move, so the caller can skip
 * the DOM write entirely — that is what keeps this feature from fighting a user's
 * own scrolling. `null` also covers "no offset can do better than the current one"
 * (a target larger than the band and already aligned, or one clamped against the
 * scroll extent), so a caller that re-asserts until it gets `null` terminates.
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
  /** Engine-order columns, the same shape `planColumns` consumes. */
  columns: readonly PlanColumnsColumnInput[];
  targetColumnId: string;
  scrollLeft: number;
  viewportWidth: number;
}

/**
 * Minimal `scrollTop` that fully reveals the target row, or `null` if it already
 * is (or if no offset would help).
 *
 * On the ArrowDown hot path — allocation-free, O(1).
 *
 * @internal
 */
export function scrollTopToReveal(
  input: ScrollTopToRevealInput,
): number | null {
  const { rowMetrics, targetIndex, scrollTop, viewportHeight } = input;

  if (targetIndex < 0 || targetIndex >= rowMetrics.rowCount) {
    return null;
  }

  // An empty band cannot reveal anything, and this is also what an unmeasured
  // viewport looks like (SSR, first commit). Writing a scroll offset from an
  // unmeasured viewport would only have to be undone.
  if (viewportHeight <= 0) {
    return null;
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
 * groups, or `null` if it already is (or if no offset would help).
 *
 * Delegates all bucketing to `planColumns` rather than re-deriving it — PR #203
 * fixed a bug whose root cause was a second, drifted copy of that math.
 *
 * @internal
 */
export function scrollLeftToReveal(
  input: ScrollLeftToRevealInput,
): number | null {
  const { columns, targetColumnId, scrollLeft, viewportWidth } = input;

  // `planColumns` virtualizes the scrollable run, so a plan built at the real
  // viewport width would omit the very columns this function exists to scroll to.
  // An infinitely wide viewport at scrollLeft 0 makes its forward walk consume the
  // whole run and its overscan clamp a no-op, so every column is present with its
  // true content offset — the same trick `create-renderer.ts:88` uses for its
  // no-viewport path.
  const plan = planColumns({
    columns,
    scrollLeft: 0,
    viewportWidth: Number.POSITIVE_INFINITY,
    overscan: 0,
  });

  let target: (typeof plan.columns)[number] | undefined;

  for (const column of plan.columns) {
    if (column.id === targetColumnId) {
      target = column;
      break;
    }
  }

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
  if (bandWidth <= 0) {
    return null;
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
