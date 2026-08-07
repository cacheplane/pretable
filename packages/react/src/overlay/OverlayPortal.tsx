import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useHydrated } from "../use-hydrated";

/**
 * Renders children into `document.body`.
 *
 * The grid viewport sets `contain: content`, which makes it a containing block
 * for `position: fixed` descendants *and* clips them to its box. Any popover
 * positioned from `getBoundingClientRect()` coordinates must therefore escape
 * the viewport subtree entirely. The hydration gate renders nothing on the
 * server and during hydration — `createPortal` has no server counterpart —
 * then swaps the portal in on the first client-only render.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  if (!hydrated || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
