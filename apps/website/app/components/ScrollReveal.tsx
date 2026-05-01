"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Wraps children and fades them in (opacity 0 → 1) + slides up
 * (translateY 24px → 0) when the wrapper's root element first becomes
 * 20% visible in the viewport. One-shot — observer disconnects after
 * the first intersection, so re-scrolling doesn't re-trigger.
 *
 * Reduced motion: under `prefers-reduced-motion: reduce`, the transition
 * is suppressed (`motion-reduce:transition-none`) and the hidden state's
 * opacity/translate are forced to the visible values
 * (`motion-reduce:opacity-100 motion-reduce:translate-y-0`), so the user
 * sees content at full opacity from first paint regardless of observer
 * status.
 *
 * SSR: initial state is `visible: false` on server + first-paint client.
 * The IntersectionObserver runs in `useEffect` (client-only). Sections
 * already in the viewport on first paint fire on mount and animate in
 * normally.
 */
export function ScrollReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        "transition-all duration-700 ease-out motion-reduce:transition-none",
        visible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-6 motion-reduce:opacity-100 motion-reduce:translate-y-0",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
