// packages/react/src/overlay/useHeaderPopover.ts
import { useCallback, useEffect, useState } from "react";

/**
 * Which popover a header cell's trailing strip has open.
 *
 * There is exactly ONE of these for the whole surface, discriminated by kind
 * rather than one hook per popover. Both buttons stop their own `pointerdown`
 * (they have to — see `FunnelButton`), which means neither ever reaches the
 * other popover's document-level outside-click listener. With independent
 * states the funnel dialog and the ⋮ menu would simply stack on top of each
 * other; with one state, opening either closes the other for free.
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

  const isOpen = openState !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    // The page moving is not, by itself, a reason to close.
    //
    // This listener used to call `close()` outright, which read as "the
    // popover must never float away from its anchor" — the right goal, applied
    // to the wrong signal. A scroll EVENT is not detachment; it is the thing
    // that might cause detachment, and the two come apart badly whenever the
    // page is already in motion when a popover opens. Measured before this: a
    // filter opened during the tail of the site's own smooth `scrollIntoView`
    // was unmounted in the same breath, in both engines, which is why
    // `grid-header-keyboard.spec.ts` had to grow a `waitForScrollSettled`
    // helper to get a filter open at all. A user mid-scroll got no such
    // helper.
    //
    // So respond to the condition rather than the event: re-measure, FOLLOW
    // the anchor while it is still on screen, and close only when it is
    // genuinely gone. Following is strictly better than closing even in the
    // cases the old rule handled — the popover stays usable through a scroll
    // instead of making the user re-open it — and there is nothing left for a
    // scrolling `.focus()` to trip over.
    const onViewportChange = () => {
      setOpenState((prev) => {
        if (prev === null) return prev;
        const next = anchorRect(prev.anchor);
        if (next === null) return null;
        // Returning `prev` publishes nothing, so a scroll that leaves the
        // anchor where it was — the grid's own vertical body scroll, under a
        // sticky header — costs one rect read and no re-render.
        return sameRect(prev.rect, next) ? prev : { ...prev, rect: next };
      });
    };

    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    // Capture: scrolls of inner elements (the grid's own viewport) do not
    // bubble to `window`, and moving the grid's header is exactly the case
    // that has to be followed.
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
    // Deliberately `isOpen` rather than `openState`: the handler reads the
    // current state through the functional updater, so re-subscribing on every
    // repositioned frame would be pure churn.
  }, [isOpen, close]);

  return { openState, toggle, close };
}
