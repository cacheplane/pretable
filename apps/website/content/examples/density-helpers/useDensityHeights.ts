import { useCallback, useRef, useSyncExternalStore } from "react";
import { getDensityHeights, type DensityHeights } from "@pretable/ui";

const SERVER_SNAPSHOT: DensityHeights = { rowHeight: 32, headerHeight: 36 };

// Every element whose attributes could change what `element` resolves to: the
// element itself, then each ancestor up to `<html>`. The density tokens are
// inherited custom properties, so a `data-density` anywhere on that chain is
// what the element paints under — watching the root alone would miss a swap on
// a wrapper, and watching the wrapper alone would miss one on the root.
function scopeChain(element: Element | null): Element[] {
  const chain: Element[] = [];
  for (
    let current = element;
    current !== null;
    current = current.parentElement
  ) {
    chain.push(current);
  }
  const root = document.documentElement;
  if (!chain.includes(root)) chain.push(root);

  return chain;
}

function subscribe(element: Element | null, onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  const observer = new MutationObserver(onChange);

  for (const node of scopeChain(element)) {
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["data-density", "data-theme", "class", "style"],
    });
  }

  return () => observer.disconnect();
}

export function useDensityHeights(element: Element | null): DensityHeights {
  const cached = useRef<DensityHeights | null>(null);

  const subscribeToScope = useCallback(
    (onChange: () => void) => subscribe(element, onChange),
    [element],
  );

  const getSnapshot = useCallback(() => {
    const next = getDensityHeights(element);
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
  }, [element]);

  return useSyncExternalStore(
    subscribeToScope,
    getSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
