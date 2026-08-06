import type { CSSProperties } from "react";

import { HEADER_HEIGHT } from "./rendering";

/**
 * Inline styles for @pretable/react's grid surface.
 *
 * Layout/positioning math only — no colors, no border-radius, no fonts,
 * no padding amounts, no backdrop-filter. Skin lives in CSS targeting
 * the engine's data attributes (`[data-pretable-*]`); see @pretable/ui's
 * grid.css for the public theming surface.
 */

export function getViewportStyle(height: number): CSSProperties {
  return {
    contain: "content",
    containIntrinsicSize: `auto ${height}px`,
    contentVisibility: "auto",
    height,
    overflow: "auto",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
    position: "relative",
  };
}

export function getHeaderRowStyle(
  totalWidth: number,
  headerHeight: number = HEADER_HEIGHT,
): CSSProperties {
  return {
    display: "flex",
    height: headerHeight,
    insetInline: 0,
    minWidth: totalWidth,
    position: "sticky",
    top: 0,
    zIndex: 3,
  };
}

export function getScrollContentStyle(
  totalHeight: number,
  totalWidth: number,
): CSSProperties {
  return {
    height: Math.max(totalHeight, 0),
    minWidth: totalWidth,
    position: "relative",
  };
}

export function getRowStyle(top: number, height: number): CSSProperties {
  return {
    boxSizing: "border-box",
    display: "flex",
    height,
    insetInline: 0,
    position: "absolute",
    top,
  };
}

export function getCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    position: "absolute",
    top: 0,
    width,
  };
}

export function getHeaderCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    position: "absolute",
    top: 0,
    width,
  };
}

export function getPinnedCellStyle(left: number): CSSProperties {
  return {
    left,
    position: "sticky",
    top: 0,
    zIndex: 1,
  };
}

/**
 * Scrollport-relative x of a right-pinned column's TRAILING edge — the anchor
 * every right-pinned overlay is measured back from, mirroring the left side's
 * `pinnedOffset + width`.
 *
 * `right` is `PlannedColumn.right`: the offset from the viewport's right edge
 * (the last right-pinned column is 0, earlier ones carry the summed width of
 * the right-pinned columns after them). `viewportWidth` is the scroll
 * viewport's `clientWidth`, i.e. the width of the sticky constraint rect.
 *
 * Right-pinning is expressed in `left` terms on purpose. Body/header rows are
 * flex containers whose unpinned cells are `position: absolute` (out of flow),
 * so a sticky cell is typically the FIRST in-flow item and its flow position is
 * the row's leading edge. A sticky `right` inset only holds a box BACK from
 * scrolling past that inset — it never pushes a box forward past its flow
 * position — so `right: 0` leaves a right-pinned cell stranded at the row's
 * left edge. A sticky `left` inset clamps from the other side: it pushes the
 * box right until its leading edge sits `left` px from the scrollport's left
 * edge and holds it there through the scroll, which is exactly right-pinning.
 *
 * Returns `undefined` when the scrollport has not been measured yet
 * (`viewportWidth` of 0 before hydration/layout, or NaN): the whole technique
 * is relative to a real measured width, and `0 - right` would be a NEGATIVE
 * left inset that parks right-pinned cells off-screen to the left. Callers
 * must fall back to the plain, non-sticky cell style; the first measurement
 * re-renders them into place.
 */
export function getPinnedRightEdge(
  viewportWidth: number,
  right: number,
): number | undefined {
  if (!(viewportWidth > 0)) {
    return undefined;
  }

  return viewportWidth - right;
}

/**
 * Zero-width anchor parked on a column's TRAILING edge. The header overlays —
 * the 4px resize strip and the 18px filter funnel — are absolutely positioned
 * inside it at negative offsets, so all of their geometry is expressed as
 * "N px back from this column's trailing edge".
 *
 * The overlays cannot carry a sticky inset themselves. The header row is a flex
 * container whose unpinned cells are `position: absolute` (out of flow), so its
 * in-flow items are exactly the sticky ones — the pinned header cells, in
 * order. An overlay rendered after its own pinned header cell therefore has a
 * FLOW position of `pinnedOffset + width`, the trailing edge, while its target
 * sits 4px or 22px BEFORE that edge. A sticky `left` inset can only push a box
 * further right than flow already put it, never pull it left, so at scrollLeft
 * 0 such an overlay stays at its flow position and overhangs the next column;
 * only once the row has scrolled far enough for the flow position to fall left
 * of the inset does the inset take over.
 *
 * Anchoring on the trailing edge is what makes the sticky inset well-behaved:
 * the anchor's target IS its flow position, so the inset is already satisfied
 * at scrollLeft 0 (no shift) and clamps the box at every offset after that. And
 * because the anchor is zero-width it adds nothing to the flow, so the next
 * pinned column's cell still starts at its own pinned offset.
 *
 * `sticky` is false for unpinned columns, whose overlays ride the scrolling
 * content — an absolute box at the same trailing edge, with no inset to satisfy.
 * The z-index is set either way so the anchor forms a stacking context: pinned
 * overlays paint above the pinned cells ({@link getPinnedCellStyle} tier 1),
 * while unpinned overlays stay below them and scroll under the pinned group.
 */
export function getHeaderOverlayAnchorStyle(
  trailingEdge: number,
  sticky: boolean,
): CSSProperties {
  return {
    height: "100%",
    left: trailingEdge,
    position: sticky ? "sticky" : "absolute",
    top: 0,
    width: 0,
    zIndex: sticky ? 5 : 0,
  };
}

/**
 * Sticky style for a right-pinned cell. `trailingEdge` comes from
 * {@link getPinnedRightEdge}; `width` is the cell's rendered width, so the
 * cell's leading edge lands at `trailingEdge - width`. Mirrors
 * {@link getPinnedCellStyle}'s z-index tier.
 */
export function getPinnedRightCellStyle(
  trailingEdge: number,
  width: number,
): CSSProperties {
  return {
    left: trailingEdge - width,
    position: "sticky",
    top: 0,
    zIndex: 1,
  };
}
