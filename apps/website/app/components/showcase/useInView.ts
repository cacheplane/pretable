"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * One-shot in-view detector for lazy-mounting heavy content. Returns
 * `[ref, inView]`; `inView` flips to `true` the first time the referenced
 * element intersects the viewport (then the observer disconnects). When
 * `IntersectionObserver` is unavailable, mounts immediately.
 */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin = "200px",
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  // Start false so the server and the client's first paint agree. Node has no
  // IntersectionObserver, so a lazy initializer reading it would render the
  // grid on the server but a placeholder on the client → hydration mismatch
  // (and would server-render the heavy grid on every load). The missing-API
  // fallback is handled client-only, inside the effect.
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot fallback when the API is unavailable
      setInView(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}
