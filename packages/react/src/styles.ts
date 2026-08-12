import type { CSSProperties } from "react";
import type { PlannedColumn } from "@pretable-internal/renderer-dom";

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

/**
 * The box that holds the group panel and the scroll viewport, used only when
 * the panel is enabled.
 *
 * It is pinned to exactly `viewportHeight` — the height the surface occupied
 * before the panel existed — because the panel *consumes* from that budget
 * rather than adding to it. Enabling the panel must not reflow a consumer's
 * layout.
 */
export function getGroupPanelWrapperStyle(
  viewportHeight: number,
): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    height: viewportHeight,
    position: "relative",
  };
}

/**
 * The box that holds the scroll viewport and the data-lifecycle body states,
 * used only once `dataState` has been supplied.
 *
 * `position: relative` is the containing block the full-bleed body states are
 * measured against, so it belongs here rather than in grid.css — a consumer
 * unsetting it would strand the block over the page instead of the grid.
 */
export function getDataStateWrapperStyle(): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    position: "relative",
  };
}

/**
 * A full-bleed body state (loading / empty / error): the viewport's body band,
 * header excluded.
 *
 * Out of flow on purpose. The viewport's own height is pinned inline, so a
 * block stacked beneath it would push the surface past `viewportHeight` and
 * leave the message stranded under a full-height empty card. Overlaying the
 * band instead keeps the surface exactly the box the consumer asked for, and
 * keeps the header — with its sort and filter controls — reachable while the
 * body has nothing to show.
 *
 * `topInset` is the height the header (plus the group panel, when enabled)
 * occupies above the band; both are already resolved in JS, and neither is
 * derivable in CSS.
 */
export function getBodyStateOverlayStyle(topInset: number): CSSProperties {
  return {
    alignItems: "center",
    bottom: 0,
    display: "flex",
    insetInline: 0,
    justifyContent: "center",
    position: "absolute",
    top: topInset,
  };
}

/**
 * The group panel strip itself. Layout only — its skin (background, chip
 * spacing, the empty message's styling) lives in @pretable/ui's grid.css.
 *
 * `flexShrink: 0` matters: the wrapper is a fixed-height flex column, so
 * without it the strip is a shrinkable item next to a viewport that carries
 * `contain: content`, and it gives up the height the viewport already
 * subtracted for it.
 *
 * ## Why the overflow scrolls sideways rather than wrapping
 *
 * The height is a theme token that `PretableSurface` SUBTRACTS from
 * `viewportHeight` so the component occupies the same box whether or not the
 * panel is enabled. Wrapping would make that height content-dependent: adding
 * the chip that starts a second line would reflow the grid underneath the user
 * mid-drag, and `insertIndexAt` would have to become two-dimensional. Scrolling
 * keeps the height fixed, so all of that stays true.
 *
 * `overflowY` has to be stated: a box with one axis `visible` and the other not
 * computes the `visible` one to `auto`, which would put a vertical scrollbar on
 * a strip one chip tall.
 *
 * `scrollbarWidth: "thin"` is here for the same height reason. Where scrollbars
 * are classic rather than overlay, a full-width one eats a third of a compact
 * 28px strip; where they are overlay, it costs nothing.
 */
export function getGroupPanelStyle(height: number): CSSProperties {
  return {
    alignItems: "center",
    boxSizing: "border-box",
    display: "flex",
    flexShrink: 0,
    height,
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "thin",
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
 * Full positioning for one body cell: the plain absolute box, plus the sticky
 * inset its pin side needs.
 *
 * Data rows and group rows both go through here so a group's aggregate lands in
 * the same pixel column as the cells beneath it, pinned or not — the one thing
 * a second hand-rolled copy of this ternary would be guaranteed to drift on.
 * `viewportWidth` is the scrollport's `clientWidth`; before it is measured a
 * right-pinned cell falls back to its plain box (see {@link getPinnedRightEdge}).
 */
export function getPositionedCellStyle(
  column: PlannedColumn,
  width: number,
  viewportWidth: number,
): CSSProperties {
  const base = getCellStyle(column.left, width);

  if (column.pinned === "left") {
    return { ...base, ...getPinnedCellStyle(column.left) };
  }

  const trailingEdge =
    column.pinned === "right" && column.right !== undefined
      ? getPinnedRightEdge(viewportWidth, column.right)
      : undefined;

  if (trailingEdge !== undefined) {
    return { ...base, ...getPinnedRightCellStyle(trailingEdge, width) };
  }

  return base;
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
