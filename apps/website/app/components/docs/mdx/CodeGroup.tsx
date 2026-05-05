"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

export function CodeGroup({ children }: { children: ReactNode }) {
  const panels = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<{ "data-language"?: string }>[];
  const [active, setActive] = useState(0);
  return (
    <div className="my-6 rounded-md border border-rule">
      <div
        role="tablist"
        className="flex border-b border-rule font-mono text-[11px]"
      >
        {panels.map((p, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`px-3 py-2 uppercase tracking-[0.1em] ${i === active ? "text-accent" : "text-text-secondary"}`}
          >
            {p.props["data-language"] ?? `tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div>{panels[active]}</div>
    </div>
  );
}
