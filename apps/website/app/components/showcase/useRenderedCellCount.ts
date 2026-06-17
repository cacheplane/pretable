"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/** Counts the cell nodes currently rendered inside `el`. */
export function countCells(el: Element): number {
  return el.querySelectorAll("[data-pretable-cell]").length;
}

/**
 * Tracks how many `[data-pretable-cell]` nodes are in the DOM inside the
 * returned ref's element, updating live (rAF-throttled) as the grid scrolls
 * and virtualizes. Does an initial synchronous count on mount plus a settle
 * pass on the next tick (grid rows mount after this effect).
 */
export function useRenderedCellCount(): {
  ref: RefObject<HTMLDivElement | null>;
  count: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const recount = () => setCount(countCells(el));
    recount();
    const settle = setTimeout(recount, 0);

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recount();
      });
    };
    // scroll does not bubble, but capture-phase listeners on an ancestor still
    // fire for descendant scroll (the grid's inner viewport).
    el.addEventListener("scroll", onScroll, true);

    return () => {
      clearTimeout(settle);
      el.removeEventListener("scroll", onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return { ref, count };
}
