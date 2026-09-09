// packages/react/src/overlay/useHeaderPopover.ts
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { observeAnchor } from "./observe-anchor";
import { useOverlayContainer } from "./portal-context";

/**
 * Which popover a header cell's trailing strip has open.
 *
 * One state per surface distinguishes the column and popover kind. Opening
 * either header action replaces the previous action; outside presses use
 * logical portal containment and explicitly exempt the owning anchor.
 */
export type HeaderPopoverKind = "filter" | "menu";

export interface HeaderPopoverState {
  kind: HeaderPopoverKind;
  columnId: string;
  /**
   * The anchor's viewport rect, as of the last time the page moved.
   *
   * `popoverStyle` turns this into `position: fixed` coordinates, so the
   * popover is only ever where the user expects it while this agrees with
   * where the anchor actually is. It is therefore RE-MEASURED on scroll and
   * resize rather than frozen at open time — see the listener below for why
   * the popover follows instead of closing.
   */
  rect: DOMRect;
  /**
   * The button that opened it. A menu hands focus back here on Escape and
   * after an item is chosen — a dialog is free to ignore it.
   */
  anchor: HTMLElement;
}

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function overlaps(a: Edges, b: Edges): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

/**
 * Where the anchor is now, or `null` if there is no longer anything to point
 * at.
 *
 * Two ways an anchor stops being one, and both have to be caught or the
 * popover is left hanging in empty space:
 *
 * - It has left the document — a column removed, a virtualized header
 *   unmounted.
 * - It has been scrolled out of sight. Out of the WINDOW is the obvious case;
 *   out of the grid's own scroll viewport is the one that is easy to miss,
 *   because a header cell scrolled horizontally past the viewport's edge still
 *   reports a perfectly ordinary rect. The grid viewport sets `contain`, so
 *   the cell is clipped there and nowhere else — testing the window alone
 *   would leave a popover pointing at a column the user can no longer see.
 */
function anchorRect(anchor: HTMLElement): DOMRect | null {
  if (!anchor.isConnected) return null;
  const rect = anchor.getBoundingClientRect();

  // A zero-area rect is not evidence that the anchor is gone: jsdom has no
  // layout engine and reports 0x0 for every element on the page. Treating it
  // as gone would close every popover in the unit suite the moment anything
  // scrolled — a "fix" that only holds up where nothing can measure it. An
  // environment that cannot decide does not get to act, so hand the rect back
  // unchanged and leave the popover alone.
  if (rect.width === 0 && rect.height === 0) return rect;

  const window_ = anchor.ownerDocument.defaultView;
  if (window_ === null) return rect;
  if (
    !overlaps(rect, {
      left: 0,
      top: 0,
      right: window_.innerWidth,
      bottom: window_.innerHeight,
    })
  ) {
    return null;
  }

  const clip = anchor.closest("[data-pretable-scroll-viewport]");
  if (clip !== null && !overlaps(rect, clip.getBoundingClientRect())) {
    return null;
  }
  return rect;
}

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

export function useHeaderPopover() {
  const [openState, setOpenState] = useState<HeaderPopoverState | null>(null);

  const toggle = useCallback(
    (
      kind: HeaderPopoverKind,
      columnId: string,
      anchorEl: HTMLElement | null,
    ) => {
      setOpenState((prev) => {
        // Only the same popover on the same column toggles shut. A different
        // kind — or the same kind on another column — switches.
        if (prev?.kind === kind && prev.columnId === columnId) return null;
        if (!anchorEl) return null;
        return {
          kind,
          columnId,
          rect: anchorEl.getBoundingClientRect(),
          anchor: anchorEl,
        };
      });
    },
    [],
  );

  const close = useCallback(() => setOpenState(null), []);

  const anchor = openState?.anchor ?? null;
  const container = useOverlayContainer();
  const measure = useCallback(() => {
    setOpenState((previous) => {
      if (previous === null) return previous;
      const next = anchorRect(previous.anchor);
      if (next === null) return null;
      return sameRect(previous.rect, next)
        ? previous
        : { ...previous, rect: next };
    });
  }, []);

  // Parent layout renders and delayed portal targets can move an anchor without
  // scrolling. Bounds equality prevents another update when nothing moved.
  useLayoutEffect(() => {
    // Publish measured DOM bounds before paint; sameRect prevents cascading updates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (anchor && container) measure();
  });

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    anchor.ownerDocument.addEventListener("keydown", onKey);
    // Follow while on-screen; anchorRect retains the existing clipping and
    // detach checks. Nested Selects observe the moved popup's style in turn.
    const stopObserving = observeAnchor(anchor, measure);
    return () => {
      anchor.ownerDocument.removeEventListener("keydown", onKey);
      stopObserving();
    };
  }, [anchor, close, measure]);

  return { openState, toggle, close };
}
