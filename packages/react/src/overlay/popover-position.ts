import type { CSSProperties } from "react";

const WIDTH = 240;
/** Gap between the anchor and the popover. */
const GAP = 4;
/** Minimum breathing room kept against every viewport edge. */
const MARGIN = 8;
/** Below-space under which the popover prefers to flip upward. */
const MIN_SPACE = 160;

/**
 * Fixed-position style from the anchor rect.
 *
 * Horizontally the popover is *clamped* into the viewport (never flipped).
 * Vertically it opens below the anchor, and flips above it when there is not
 * enough room below and more room above. A flipped popover is anchored by
 * `bottom` rather than `top`, so its own (unknown, content-driven) height
 * never has to be measured. No `max-height` is set — each popover's CSS owns
 * its own height cap.
 */
export function popoverStyle(rect: DOMRect): CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  const left = Math.min(rect.left, vw - WIDTH - MARGIN);

  const spaceBelow = vh - rect.bottom - GAP - MARGIN;
  const spaceAbove = rect.top - GAP - MARGIN;
  const flip = spaceBelow < MIN_SPACE && spaceAbove > spaceBelow;

  return {
    position: "fixed",
    ...(flip ? { bottom: vh - rect.top + GAP } : { top: rect.bottom + GAP }),
    left: Math.max(MARGIN, left),
    width: WIDTH,
    zIndex: 50,
  };
}
