"use client";

import {
  Children,
  isValidElement,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { isNavKey, nextTabIndex } from "./rovingTabs";

interface TabProps {
  label: string;
  children: ReactNode;
}

// Tab is a marker component — Tabs reads its props directly via Children, and
// never renders it. See the note on `isTab` below for why the marker cannot
// also be the thing Tabs matches on.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Tab(props: TabProps): ReactNode {
  return null;
}

/**
 * Recognise a `<Tab>` child by the prop it must carry, NOT by `child.type ===
 * Tab`.
 *
 * The identity check is the obvious way to write this and it is silently
 * wrong in this app, because the boundary it has to cross is a React Server
 * Components boundary. The docs MDX is compiled by `compileMDX` inside a
 * server component (`lib/docs/load.ts`), so when it creates a `<Tab>` element
 * the `Tab` it uses is not this function — `Tabs.tsx` is a `"use client"`
 * module, so everything the server graph imports from it is a client
 * *reference* object. React Flight serialises those children faithfully (the
 * payload for `/docs/streaming` really does carry both `<Tab>` elements with
 * their labels and bodies), but each child arrives on the client with a
 * `type` that is still a reference object rather than this module's `Tab`.
 * `child.type === Tab` is therefore `false` for every child, `tabs` came out
 * empty, and `<Tabs>` rendered an empty tablist over an empty tabpanel.
 *
 * The visible cost was the whole "Pick the connector" section of
 * `/docs/streaming` — both connector snippets — missing from the page, with
 * no error anywhere. Nothing in jsdom can see it: under `compileMDX` in a
 * plain React tree there is no client boundary, the identity check holds, and
 * the old unit test passed throughout.
 *
 * `label` is a serialisable prop, so it survives the boundary intact. Matching
 * on it is also closer to what the rule actually is: a `<Tabs>` child is a tab
 * if it names one.
 */
function isTab(child: ReactNode): child is ReactElement<TabProps> {
  return (
    isValidElement<Partial<TabProps>>(child) &&
    typeof child.props.label === "string"
  );
}

export function Tabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter(isTab);
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Unique per mounted instance so two <Tabs> on one page never cross-wire
  // their aria-controls/aria-labelledby, which resolve by getElementById.
  const uid = useId();
  const tabId = (i: number) => `${uid}-tab-${i}`;
  const panelId = `${uid}-panel`;

  const select = (index: number) => {
    setActive(index);
    // Activating a tab moves focus to it (APG). Done explicitly rather than
    // left to the browser: Safari does not focus a clicked button.
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavKey(e.key)) return;
    // Home/End would otherwise scroll the page out from under the reader.
    e.preventDefault();
    select(nextTabIndex(index, tabs.length, e.key));
  };

  if (tabs.length === 0) return null;

  return (
    <div className="my-6 rounded-md border border-rule">
      <div
        role="tablist"
        className="flex border-b border-rule font-mono text-[12px]"
      >
        {tabs.map((t, i) => (
          <button
            key={t.props.label}
            type="button"
            role="tab"
            id={tabId(i)}
            aria-controls={panelId}
            aria-selected={i === active}
            // Roving: exactly one stop for the strip, arrows to move inside
            // it. Do NOT "simplify" this to a blanket 0 — that is the
            // Chromium-only behaviour this replaced, where every tab was its
            // own tab stop.
            tabIndex={i === active ? 0 : -1}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => select(i)}
            className={`px-3 py-2 ${i === active ? "text-accent border-b-2 border-b-accent -mb-px" : "text-text-secondary hover:text-text-primary"}`}
          >
            {t.props.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(active)}
        className="p-4"
      >
        {tabs[active]?.props.children}
      </div>
    </div>
  );
}
