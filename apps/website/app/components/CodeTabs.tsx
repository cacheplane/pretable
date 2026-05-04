"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export interface CodeTabsPanel {
  filename: string;
  lang: "ts" | "tsx";
  html: ReactNode;
}

export interface CodeTabsProps {
  panels: readonly CodeTabsPanel[];
  defaultIndex?: number;
}

export function CodeTabs({ panels, defaultIndex = 0 }: CodeTabsProps) {
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (activeIndex + delta + panels.length) % panels.length;
    setActiveIndex(next);
    const tabs =
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[next]?.focus();
  };

  const active = panels[activeIndex];

  return (
    <div className="overflow-hidden rounded-[6px] border border-grid-rule bg-grid-bg">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Code example files"
        onKeyDown={onKeyDown}
        className="flex flex-row items-stretch gap-0 overflow-x-auto border-b border-grid-rule bg-text-primary"
      >
        {panels.map((panel, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={panel.filename}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIndex(i)}
              className={[
                "inline-flex shrink-0 cursor-pointer items-center gap-2 px-4 py-2.5 font-mono text-[12px] transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
                isActive
                  ? "border-b-2 border-bg-page text-bg-page"
                  : "border-b-2 border-transparent text-text-muted hover:text-bg-page",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "rounded-[2px] px-1 py-0.5 text-[9px] font-bold tracking-[0.05em]",
                  panel.lang === "tsx"
                    ? "bg-accent/15 text-accent"
                    : "bg-bg-page/15 text-bg-page",
                ].join(" ")}
              >
                {panel.lang.toUpperCase()}
              </span>
              {panel.filename}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeIndex}`}
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
      >
        {active.html}
      </div>
    </div>
  );
}
