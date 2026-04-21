import type { CSSProperties } from "react";

import { HEADER_HEIGHT } from "./rendering";

export function getViewportStyle(height: number): CSSProperties {
  return {
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
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

export function getHeaderRowStyle(totalWidth: number): CSSProperties {
  return {
    backdropFilter: "blur(8px)",
    background: "rgba(18, 18, 18, 0.94)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    display: "flex",
    height: HEADER_HEIGHT,
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
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
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
    padding: "10px 12px",
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
    padding: "12px",
    position: "absolute",
    top: 0,
    width,
  };
}

export function getPinnedCellStyle(left: number): CSSProperties {
  return {
    background: "rgba(18, 18, 18, 0.96)",
    left,
    position: "sticky",
    top: 0,
    zIndex: 1,
  };
}
