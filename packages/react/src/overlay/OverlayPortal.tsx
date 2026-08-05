import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const isClient = () => true;
const isServer = () => false;

/**
 * Renders children into `document.body`.
 *
 * The grid viewport sets `contain: content`, which makes it a containing block
 * for `position: fixed` descendants *and* clips them to its box. Any popover
 * positioned from `getBoundingClientRect()` coordinates must therefore escape
 * the viewport subtree entirely. The store gate renders nothing on the server
 * and during hydration — `createPortal` has no server counterpart — then swaps
 * the portal in on the first client-only render.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribe, isClient, isServer);
  if (!hydrated || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
