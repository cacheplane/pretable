// packages/react/src/filter-menu/useFilterPopover.ts
import { useCallback, useEffect, useState } from "react";

export { popoverStyle } from "../overlay/popover-position";

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
