"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

interface TabProps {
  label: string;
  children: ReactNode;
}

export function Tab(_: TabProps): ReactNode {
  return null;
}

export function Tabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter(
    (c): c is ReactElement<TabProps> => isValidElement(c) && c.type === Tab,
  );
  const [active, setActive] = useState(0);
  return (
    <div className="my-6 rounded-md border border-rule">
      <div
        role="tablist"
        className="flex border-b border-rule font-mono text-[12px]"
      >
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`px-3 py-2 ${i === active ? "text-accent border-b-2 border-b-accent -mb-px" : "text-text-secondary hover:text-text-primary"}`}
          >
            {t.props.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-4">
        {tabs[active]?.props.children}
      </div>
    </div>
  );
}
