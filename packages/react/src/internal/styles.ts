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
