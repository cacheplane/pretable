import { useCallback, useRef, useSyncExternalStore } from "react";
import { getDensityHeights, type DensityHeights } from "@pretable/ui";

const SERVER_SNAPSHOT: DensityHeights = { rowHeight: 32, headerHeight: 36 };

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density", "data-theme", "class", "style"],
  });

  return () => observer.disconnect();
}

export function useDensityHeights(): DensityHeights {
  const cached = useRef<DensityHeights | null>(null);

  const getSnapshot = useCallback(() => {
    const next = getDensityHeights();
    const prev = cached.current;

    // `useSyncExternalStore` calls this on every render and compares by
    // reference. Returning a fresh object each time is an infinite render
    // loop, so hand back the previous one when the numbers have not moved.
    if (
      prev !== null &&
      prev.rowHeight === next.rowHeight &&
      prev.headerHeight === next.headerHeight
    ) {
      return prev;
    }

    cached.current = next;

    return next;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
