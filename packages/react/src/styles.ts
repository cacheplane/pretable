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
 */
export function getPinnedRightEdge(
  viewportWidth: number,
  right: number,
): number {
  return viewportWidth - right;
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
