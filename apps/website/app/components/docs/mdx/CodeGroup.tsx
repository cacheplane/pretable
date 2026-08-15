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

/**
 * Identity of the code surface a `<CodeGroup>` child wraps — its fence
 * `title="…"` if it has one, else its language.
 *
 * This used to read `child.props["data-language"]`, which can never resolve.
 * A `<CodeGroup>` child in MDX is a fenced block, and by the time it reaches
 * this component it has been through `MdxRenderer`'s `figure` → `Figure` →
 * `Pre` → `CodeBlock` chain, all of which are server components. React
 * renders them on the server and serialises the *output*, so what arrives
 * here is `<figure className="my-6 …"><CodeSurface filename language raw …/>
 * </figure>` — read out of the real Flight payload for `/docs/streaming`, not
 * assumed. `data-language` sits on the `<code>` node several levels below,
 * and never on the child's own props, so every tab fell back to `tab N`.
 *
 * Hence a search rather than a fixed `child.props.children.props.language`:
 * the exact depth is an implementation detail of `CodeBlock`, and one added
 * wrapper would silently put the label back to `tab N`. Searching for the
 * props by name survives that.
 *
 * Caveat, stated rather than papered over: `<CodeGroup>` is used on zero docs
 * pages, so unlike `Tabs` this has no live page to prove it against, and the
 * jsdom test below cannot model the server/client boundary that broke `Tabs`
 * (see the note on `isTab` there). It is safe in the sense that matters —
 * finding nothing yields `tab N`, exactly the behaviour it replaces — but the
 * durable fix is for `MdxRenderer` to thread a label in explicitly, the way
 * `Pre` already threads `language` into `CodeBlock`.
 */
function codeIdentity(node: ReactNode, depth = 0): string | undefined {
  if (depth > 6 || !isValidElement(node)) return undefined;
  const props = node.props as {
    filename?: unknown;
    language?: unknown;
    children?: ReactNode;
  };
  if (typeof props.filename === "string") return props.filename;
  if (typeof props.language === "string") return props.language;
  for (const child of Children.toArray(props.children)) {
    const found = codeIdentity(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function CodeGroup({ children }: { children: ReactNode }) {
  const panels = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<{ children?: ReactNode }>[];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Unique per mounted instance: aria-controls/aria-labelledby resolve by
  // getElementById, so literal ids would cross-wire two groups on one page.
  const uid = useId();
  const tabId = (i: number) => `${uid}-tab-${i}`;
  const panelId = `${uid}-panel`;

  const select = (index: number) => {
    setActive(index);
    // Activating a tab moves focus to it (APG). Explicit because Safari does
    // not focus a clicked button.
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavKey(e.key)) return;
    // Home/End would otherwise scroll the page instead of moving the tab.
    e.preventDefault();
    select(nextTabIndex(index, panels.length, e.key));
  };

  if (panels.length === 0) return null;

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
            id={tabId(i)}
            aria-controls={panelId}
            aria-selected={i === active}
            // Roving: one tab stop for the whole strip, arrows within it. A
            // blanket 0 here would make every tab its own stop — the
            // Chromium behaviour this replaced — and leaving it off entirely
            // put the strip out of Safari's tab order altogether.
            tabIndex={i === active ? 0 : -1}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => select(i)}
            className={`px-3 py-2 uppercase tracking-[0.1em] ${i === active ? "text-accent" : "text-text-secondary"}`}
          >
            {codeIdentity(p) ?? `tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(active)}>
        {panels[active]}
      </div>
    </div>
  );
}
