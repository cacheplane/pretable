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
   * The anchor's rect at open time. Popovers close on scroll/resize rather
   * than reposition, so this is never re-measured.
   */
  rect: DOMRect;
  /**
   * The button that opened it. A menu hands focus back here on Escape and
   * after an item is chosen — a dialog is free to ignore it.
   */
  anchor: HTMLElement;
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

  useEffect(() => {
    if (!openState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Close on scroll/resize so the popover never floats away from its anchor.
    const onViewportChange = () => close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [openState, close]);

  return { openState, toggle, close };
}
