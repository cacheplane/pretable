"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface LayerStackItem {
  /** Stable React key. */
  key: string;
  /** Per-layer className (e.g. accent/non-accent border + background). */
  className: string;
  /** Layer body — the structural <li> children. */
  children: ReactNode;
}

interface LayerStackProps {
  items: readonly LayerStackItem[];
  /** ms between each child's reveal start. Default 70. */
  staggerMs?: number;
  /** intersection threshold to trigger. Default 0.2. */
  threshold?: number;
  /** Forwarded to the <ol>. */
  className?: string;
  /** Forwarded to the <ol> for test targeting. */
  testId?: string;
}

// Staggered scroll-reveal layer stack. Owns its <ol> and <li> markup so
// list semantics stay correct (no wrapper div between <ol> and <li>).
//
// One-shot IntersectionObserver on the <ol>; per-<li> transitionDelay
// drives the cascade. Reduced-motion: under prefers-reduced-motion: reduce,
// rows fade in together with no translate.
export function LayerStack({
  items,
  staggerMs = 70,
  threshold = 0.2,
  className,
  testId,
}: LayerStackProps) {
  const ref = useRef<HTMLOListElement | null>(null);
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

  const transitionClasses =
    "transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none motion-reduce:duration-200";
  const visibleClasses = "opacity-100 translate-x-0";
  const hiddenClasses =
    "opacity-0 -translate-x-3 motion-reduce:translate-x-0 motion-reduce:opacity-100";

  return (
    <ol ref={ref} role="list" data-testid={testId} className={className}>
      {items.map((item, i) => {
        const style: CSSProperties = {
          transitionDelay: `${i * staggerMs}ms`,
        };
        return (
          <li
            key={item.key}
            style={style}
            className={[
              item.className,
              transitionClasses,
              revealed ? visibleClasses : hiddenClasses,
            ].join(" ")}
          >
            {item.children}
          </li>
        );
      })}
    </ol>
  );
}
