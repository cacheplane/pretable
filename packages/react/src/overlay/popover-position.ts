import type { CSSProperties } from "react";

/** Fixed-position style from the anchor rect, flipped near the right/bottom edges. */
export function popoverStyle(rect: DOMRect): CSSProperties {
  const WIDTH = 240;
  const MARGIN = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const left = Math.min(rect.left, vw - WIDTH - MARGIN);
  return {
    position: "fixed",
    top: rect.bottom + 4,
    left: Math.max(MARGIN, left),
    width: WIDTH,
    zIndex: 50,
  };
}
