import type { RefObject } from "react";

// Weak keys plus explicit detach cleanup avoid keeping abandoned portal trees.
const origins = new WeakMap<Node, RefObject<HTMLElement | null>>();

export function registerPortalBoundary(
  boundary: Node,
  origin: RefObject<HTMLElement | null>,
): () => void {
  origins.set(boundary, origin);
  return () => {
    origins.delete(boundary);
  };
}

/** Physical descendants and descendants reached through nested portal origins. */
export function logicallyContains(root: Node | null, target: Node): boolean {
  const seen = new Set<Node>();
  for (let node: Node | null = target; node && !seen.has(node);) {
    if (root?.contains(node)) return true;
    seen.add(node);
    node = origins.get(node)?.current ?? node.parentNode;
  }
  return false;
}
