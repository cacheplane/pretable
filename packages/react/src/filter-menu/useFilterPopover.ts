// packages/react/src/filter-menu/useFilterPopover.ts
import { useCallback, useEffect, useState, type CSSProperties } from "react";

export interface PopoverState {
  columnId: string;
  rect: DOMRect;
}

export function useFilterPopover() {
  const [openState, setOpenState] = useState<PopoverState | null>(null);

  const toggle = useCallback(
    (columnId: string, anchorEl: HTMLElement | null) => {
      setOpenState((prev) => {
        if (prev?.columnId === columnId) return null;
        const rect = anchorEl?.getBoundingClientRect();
        return rect ? { columnId, rect } : null;
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
