/**
 * The pane-resize arithmetic, React-free — the clamp, the keyboard step and
 * the drag delta live here so the direction flip (the mutation-prone branch)
 * is table-testable without a DOM. The handle in `ToolPanel.tsx` owns the
 * gesture (capture, Escape, commit) and calls in for every number it applies.
 *
 * ## Direction (spec A6)
 *
 * The pane docks at the layout row's inline END, so the resize seam — the
 * pane's inline-start edge — moves toward inline-start as the pane grows.
 * "Grow the pane" is therefore the arrow that drags the seam that way in the
 * current writing direction: ArrowLeft in `ltr`, ArrowRight in `rtl`; a drag
 * grows the pane as the pointer travels toward inline-start. Both key and
 * drag share `growthSign` so the two inputs cannot be inverted independently.
 */

/** Writing direction, resolved by the caller from the rendered handle. */
export type PaneResizeDirection = "ltr" | "rtl";

export interface PaneWidthBounds {
  readonly min: number;
  /**
   * `null` = the surface has no width measurement yet (first render, jsdom, a
   * detached observer). Only the floor applies then — a clamp must never
   * invent a ceiling, or a controlled width asserted before the observer's
   * first delivery would be "clamped" to a number nobody chose.
   */
  readonly max: number | null;
}

/**
 * The pane's width floor, in px.
 *
 * Measured (2026-08-30, Chromium via the `fixtures/tool-panel-sections`
 * route) against the filters section's narrowest usable row, per spec A4:
 * the filter row wraps, so its floor is set by the widest control that must
 * fit a wrapped line alone — the operator `<select>`, whose max-content
 * width over its longest option ("does not contain", text vocabulary) is
 * 161px. On its wrapped line the control receives `pane − 25px` (4px row
 * padding ×2 + 8px section padding ×2 + 1px pane border), so the narrowest
 * pane that renders every operator label unclipped is 161 + 25 = 186px.
 */
export const PANE_MIN_WIDTH_PX = 186;

/** One arrow-key step, px — the header column-resize's keyboard granularity. */
export const PANE_KEY_STEP_PX = 16;

/** Clamp into bounds; rounds first so a live drag commits whole pixels. */
export function clampPaneWidth(px: number, bounds: PaneWidthBounds): number {
  const rounded = Math.round(px);
  const floored = Math.max(bounds.min, rounded);
  return bounds.max === null ? floored : Math.min(bounds.max, floored);
}

/** +1 when travel toward positive clientX grows the pane, else −1. */
function growthSign(dir: PaneResizeDirection): 1 | -1 {
  return dir === "rtl" ? 1 : -1;
}

/**
 * The width after one keydown on the handle, or `null` for a key this module
 * does not own (Enter's reset is the component's — it needs the default,
 * which is state, not arithmetic).
 */
export function paneWidthAfterKey(
  key: string,
  current: number,
  opts: { min: number; max: number | null; dir: PaneResizeDirection },
): number | null {
  const bounds: PaneWidthBounds = { min: opts.min, max: opts.max };
  switch (key) {
    case "ArrowLeft":
      return clampPaneWidth(
        current - growthSign(opts.dir) * PANE_KEY_STEP_PX,
        bounds,
      );
    case "ArrowRight":
      return clampPaneWidth(
        current + growthSign(opts.dir) * PANE_KEY_STEP_PX,
        bounds,
      );
    case "Home":
      return opts.min;
    case "End":
      // No measured max → no destination. A no-op, not a jump to some
      // sentinel: End means "as wide as allowed", and unmeasured bounds
      // do not know what is allowed.
      return opts.max === null ? current : opts.max;
    default:
      return null;
  }
}

/** The live width while a drag's pointer sits at `currentX`. */
export function paneWidthAfterDrag(
  startWidth: number,
  startX: number,
  currentX: number,
  dir: PaneResizeDirection,
  bounds: PaneWidthBounds,
): number {
  return clampPaneWidth(
    startWidth + growthSign(dir) * (currentX - startX),
    bounds,
  );
}
