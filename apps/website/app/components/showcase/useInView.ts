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
  // When IntersectionObserver is unavailable (e.g. SSR or old browsers), mount
  // immediately by starting in-view. Lazy initializer runs once, avoiding a
  // synchronous setState inside the effect.
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (inView) return;
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
