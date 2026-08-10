/**
 * The group panel's horizontal scrolling: revealing a chip that focus landed
 * on, and moving the strip when a drag reaches its edge.
 *
 * The panel is a fixed-height, nowrap flex row whose overflow scrolls sideways
 * (see `getGroupPanelStyle` for why it scrolls rather than wraps). That buys a
 * stable height at the price of two things the browser will not do for us:
 *
 * 1. Keyboard focus can move to a chip that is scrolled out of sight. The
 *    browser's own focus scrolling would fix that — but it scrolls **every**
 *    scrollable ancestor, so revealing a chip in a 100px strip can also scroll
 *    the whole document sideways. So chips are focused with `preventScroll` and
 *    revealed by `revealChipInPanel`, which touches one axis of one element.
 *    ag-grid hand-rolls the same thing for the same reason
 *    (`_scrollContainerHorizontallyToShowChild`).
 * 2. A drag cannot reach a drop position that is scrolled out, because holding
 *    the pointer at the edge does nothing. `createGroupPanelAutoscroll` is the
 *    ticker that fixes that.
 *
 * Like `group-panel-hit-test`, this is pure DOM geometry with no React in it —
 * and for the same reason: jsdom reports zero for every rect and does not
 * scroll, so none of it can be unit-tested. It is proven in
 * `apps/website/e2e/grouping.spec.ts`, in both engines.
 *
 * @internal
 */

/**
 * How close to an edge a drag has to get before the strip starts moving.
 * ag-grid uses 50 (`moveColumnFeature.ts:578-641`); a little less here because
 * our strip is shorter than a full column-drop zone, and a buffer that is a
 * large fraction of the box leaves no still zone in the middle.
 */
const AUTOSCROLL_BUFFER_PX = 40;

/**
 * Distance moved per frame when the pointer is hard against the edge. The step
 * scales down towards 1px at the far side of the buffer, so the same gesture
 * covers "nudge one chip over" and "run to the far end" without a modifier.
 */
const AUTOSCROLL_MAX_STEP_PX = 14;

/**
 * Scroll `panel` the minimum distance that brings `chip` fully inside it.
 *
 * Deliberately not `chip.scrollIntoView({ inline: "nearest" })`: that walks
 * every scrollable ancestor up to the document. See the module note.
 *
 * Measured against the panel's **content box**, not its border box. The strip's
 * inline padding is its gutter, and stopping at the border edge would park a
 * revealed chip flush against it — where the 2px focus ring that put it there,
 * plus its 1px offset, is exactly what gets clipped. Revealing a chip so its
 * focus indicator is invisible is the bug with extra steps.
 *
 * A chip wider than the content box cannot be fully revealed, so its left edge
 * wins: that is where its label starts.
 */
export function revealChipInPanel(
  panel: HTMLElement | null,
  chip: HTMLElement | null,
): void {
  if (!panel || !chip) return;
  if (panel.scrollWidth <= panel.clientWidth) return;

  const panelRect = panel.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const style = getComputedStyle(panel);
  // `clientLeft` is the border, `clientWidth` the padding box. Inset by the
  // padding to land on the content box.
  const paddingBoxLeft = panelRect.left + panel.clientLeft;
  const viewLeft = paddingBoxLeft + (parseFloat(style.paddingLeft) || 0);
  const viewRight =
    paddingBoxLeft + panel.clientWidth - (parseFloat(style.paddingRight) || 0);

  const overLeft = viewLeft - chipRect.left;
  const overRight = chipRect.right - viewRight;
  if (overLeft > 0) {
    panel.scrollLeft -= overLeft;
  } else if (overRight > 0) {
    panel.scrollLeft += overRight;
  }
}

export interface GroupPanelAutoscroll {
  /**
   * Report the live pointer position. Safe to call on every `pointermove`:
   * it starts the ticker, keeps it fed, or lets it lapse, as the position
   * warrants.
   */
  update(panel: HTMLElement | null, clientX: number, clientY: number): void;
  /** End the gesture. Must be called on pointerup, cancel, Escape and unmount. */
  stop(): void;
}

/**
 * A ticker that scrolls the panel while a drag rests near one of its edges.
 *
 * `onScroll` is called after every step that actually moved the strip, with the
 * unchanged pointer position. That callback is not optional bookkeeping: the
 * pointer is *stationary* during an autoscroll, so no further `pointermove`
 * arrives, and without re-running the hit test the drop indicator would freeze
 * in place while the chips slid underneath it.
 *
 * ## Two choices worth defending
 *
 * **`requestAnimationFrame`, where ag-grid uses `setInterval`.** The work is
 * "move some pixels and repaint", which is what rAF is for: it self-throttles
 * to the display, cannot queue up behind a slow frame, and stops on its own in
 * a background tab. There is no timer id to leak — a frame that is never
 * requested is the whole of the cleanup.
 *
 * **The pointer must be inside the panel's rect**, using the same half-open
 * convention as `hitTestGroupPanel`. So the strip scrolls exactly when a drop
 * would land in it, and a header dragged along the header row 200px below the
 * panel does not quietly scroll it. The cost is that overshooting past the edge
 * stops the scroll — which is honest, because it also stops the drop.
 */
export function createGroupPanelAutoscroll(
  onScroll: (clientX: number, clientY: number) => void,
): GroupPanelAutoscroll {
  let frame: number | null = null;
  let panel: HTMLElement | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const stepForPointer = (): number => {
    if (!panel) return 0;
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 0;
    if (pointerY < rect.top || pointerY >= rect.bottom) return 0;
    if (pointerX < rect.left || pointerX >= rect.right) return 0;

    const fromLeft = pointerX - rect.left;
    if (fromLeft < AUTOSCROLL_BUFFER_PX) return -stepForDistance(fromLeft);
    const fromRight = rect.right - pointerX;
    if (fromRight < AUTOSCROLL_BUFFER_PX) return stepForDistance(fromRight);
    return 0;
  };

  const tick = () => {
    frame = null;
    const delta = stepForPointer();
    if (delta === 0 || !panel) return;

    const before = panel.scrollLeft;
    panel.scrollLeft = before + delta;
    // Already against the end: stop rather than spin a frame a second forever.
    // A later `update` will start us again if the pointer moves somewhere that
    // has room to travel.
    if (panel.scrollLeft === before) return;

    onScroll(pointerX, pointerY);
    frame = requestAnimationFrame(tick);
  };

  return {
    update(nextPanel, clientX, clientY) {
      panel = nextPanel;
      pointerX = clientX;
      pointerY = clientY;
      if (frame !== null) return;
      if (stepForPointer() === 0) return;
      frame = requestAnimationFrame(tick);
    },
    stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      panel = null;
    },
  };
}

function stepForDistance(distance: number): number {
  const depth = AUTOSCROLL_BUFFER_PX - Math.max(distance, 0);
  return Math.max(
    1,
    Math.ceil((depth / AUTOSCROLL_BUFFER_PX) * AUTOSCROLL_MAX_STEP_PX),
  );
}
