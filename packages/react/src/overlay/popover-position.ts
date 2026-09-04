import type { CSSProperties } from "react";

/**
 * The DIALOG width — one column of form controls (`FilterMenu`'s operator
 * select over its value input) and the cell editors' panels. It doubles as
 * the horizontal-clamp bound for every popover, menus included: clamping
 * against the widest a popover can be is what makes the right edge safe
 * without measuring anything.
 */
const WIDTH = 240;
/** A list-shaped menu narrower than this reads as a stray chip, not a menu. */
const MENU_MIN_WIDTH = 160;
/** Gap between the anchor and the popover. */
const GAP = 4;
/** Minimum breathing room kept against every viewport edge. */
const MARGIN = 8;
/** Below-space under which the popover prefers to flip upward. */
const MIN_SPACE = 160;

/**
 * Where the popover sits: `position: fixed` coordinates from the anchor rect.
 *
 * Horizontally the popover is *clamped* into the viewport (never flipped).
 * Vertically it opens below the anchor, and flips above it when there is not
 * enough room below and more room above. A flipped popover is anchored by
 * `bottom` rather than `top`, so its own (unknown, content-driven) height
 * never has to be measured. No `max-height` is set — each popover's CSS owns
 * its own height cap.
 */
function placement(rect: DOMRect): CSSProperties {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  // Clamped against WIDTH even for a content-sized menu, which can only be
  // narrower: the popover is then further from the right edge than it needed
  // to be, never past it. Measuring the real width would mean a layout pass
  // and a second paint at a corrected position.
  const left = Math.min(rect.left, vw - WIDTH - MARGIN);

  const spaceBelow = vh - rect.bottom - GAP - MARGIN;
  const spaceAbove = rect.top - GAP - MARGIN;
  const flip = spaceBelow < MIN_SPACE && spaceAbove > spaceBelow;

  return {
    position: "fixed",
    ...(flip ? { bottom: vh - rect.top + GAP } : { top: rect.bottom + GAP }),
    left: Math.max(MARGIN, left),
    zIndex: 50,
  };
}

/**
 * A DIALOG-shaped popover: a fixed {@link WIDTH} column, because the form
 * controls inside it stretch to their container and a shrink-wrapped one
 * would be as narrow as its widest option string.
 */
export function popoverStyle(rect: DOMRect): CSSProperties {
  return { ...placement(rect), width: WIDTH };
}

/**
 * A MENU-shaped popover: sized to its own longest label instead of the
 * dialog's column. `Pin right` and `Group by this column` are ~60px and
 * ~150px of text; both were drawn in a 240px box, which left an item's click
 * target and its words in different halves of a mostly empty rectangle.
 *
 * A floor and a cap rather than free-running content width — the labels are
 * caller data (a column header, for `AddGroupMenu`), so neither end can be
 * left to them.
 */
export function menuPopoverStyle(rect: DOMRect): CSSProperties {
  return {
    ...placement(rect),
    width: "max-content",
    minWidth: MENU_MIN_WIDTH,
    maxWidth: WIDTH,
  };
}
