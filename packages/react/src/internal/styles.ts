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

export function getHeaderRowStyle(templateColumns: string): CSSProperties {
  return {
    backdropFilter: "blur(8px)",
    background: "rgba(18, 18, 18, 0.94)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    display: "grid",
    gridTemplateColumns: templateColumns,
    insetInline: 0,
    minHeight: HEADER_HEIGHT,
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

export function getRowStyle(
  templateColumns: string,
  top: number,
  height: number,
): CSSProperties {
  return {
    alignItems: "start",
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    boxSizing: "border-box",
    display: "grid",
    gap: 12,
    gridTemplateColumns: templateColumns,
    height,
    insetInline: 0,
    padding: "10px 12px",
    position: "absolute",
    top,
  };
}

export function getPinnedCellStyle(left?: number): CSSProperties | undefined {
  if (left === undefined) {
    return undefined;
  }

  return {
    background: "rgba(18, 18, 18, 0.96)",
    left,
    position: "sticky",
    zIndex: 1,
  };
}
