"use client";

import { useEffect, useState } from "react";

import type { DocsHeading } from "../../../lib/docs/extract-headings";

export function DocsTOC({ headings }: { headings: DocsHeading[] }) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    const els = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSlug(visible[0].target.id);
      },
      { rootMargin: "-44px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  return (
    <nav aria-labelledby="toc-label">
      <p
        id="toc-label"
        className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim"
      >
        On this page
      </p>
      <ul className="flex flex-col gap-1">
        {headings.map((h) => {
          const active = h.slug === activeSlug;
          return (
            <li key={h.slug} className={h.depth === 3 ? "pl-4" : ""}>
              <a
                aria-current={active ? "location" : undefined}
                href={`#${h.slug}`}
                className={`text-[12.5px] ${active ? "text-accent" : "text-text-secondary hover:text-text-primary"}`}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
