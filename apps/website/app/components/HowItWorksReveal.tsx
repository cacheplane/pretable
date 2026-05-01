"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface HowItWorksRevealProps {
  children: ReactNode[];
  /** ms between each child's reveal start. Default 70. */
  staggerMs?: number;
  /** ms before the first child reveals (after observer fires). Default 0. */
  initialDelayMs?: number;
  /** intersection threshold to trigger. Default 0.2. */
  threshold?: number;
  /** className applied to the wrapper element. */
  className?: string;
}

// Staggered scroll-reveal for the HowItWorks layer stack. Each child gets its
// own transition-delay so layers cascade in from the left as the section
// enters view. One-shot — observer disconnects after first intersection.
//
// Reduced-motion: under prefers-reduced-motion: reduce, all children fade
// in together with no translate (matches site-wide ScrollReveal contract).
export function HowItWorksReveal({
  children,
  staggerMs = 70,
  initialDelayMs = 0,
  threshold = 0.2,
  className,
}: HowItWorksRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={className}>
      {children.map((child, i) => (
        <div
          key={i}
          style={{ transitionDelay: `${initialDelayMs + i * staggerMs}ms` }}
          className={[
            "transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none motion-reduce:duration-200",
            revealed
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-3 motion-reduce:translate-x-0 motion-reduce:opacity-100",
          ].join(" ")}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
