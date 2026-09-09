import {
  createElement,
  Fragment,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { registerPortalBoundary } from "./logical-containment";
import { useOverlayContainer } from "./portal-context";

/** Escapes clipping while retaining the source tree's logical containment. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const container = useOverlayContainer();
  const origin = useRef<HTMLSpanElement>(null);
  const unregister = useRef<(() => void) | null>(null);
  const attachBoundary = useCallback((node: HTMLDivElement | null) => {
    unregister.current?.();
    unregister.current = node ? registerPortalBoundary(node, origin) : null;
  }, []);
  return (
    <>
      <span
        data-pretable-overlay-origin=""
        hidden
        aria-hidden="true"
        ref={origin}
      />
      {container
        ? createPortal(
            <div
              data-pretable-overlay-root=""
              ref={attachBoundary}
              style={{ display: "contents" }}
            >
              {children}
            </div>,
            container,
          )
        : null}
    </>
  );
}
