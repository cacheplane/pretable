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
 * `<CodeGroup>` is still used on zero pages under `content/docs`, so there is
 * no live docs page to pin this to. `/fixtures/code-group` stands in for one:
 * it compiles this same MDX through `compileMDX` + rehype-pretty-code +
 * `docsMdxComponents` from a SERVER component, which is what puts the real
 * RSC boundary between the fences and this file, and
 * `e2e/docs-code-group.spec.ts` asserts the tabs read `grid.ts` and `python`
 * rather than `tab 1` / `tab 2` — in the streamed HTML as well as the DOM.
 * Restoring the `data-language` read fails all six of those checks in both
 * engines, so the shape described above is now a checked fact rather than a
 * transcription of one Flight payload.
 *
 * That matters because the jsdom test below cannot check it. It reproduces
 * the serialised shape BY HAND, so it can only ever confirm that this
 * function reads the shape the test author believed in; a wrong belief would
 * pass jsdom and still ship a broken page. That is precisely how `Tabs`
 * rendered nothing on the real site for years while its unit test was green
 * (see the note on `isTab` there).
 *
 * Still worth doing eventually: have `MdxRenderer` thread a label in
 * explicitly, the way `Pre` already threads `language` into `CodeBlock`. That
 * would make the label a declared prop instead of something recovered by
 * searching, and no amount of testing here makes the search as good as not
 * needing one. It is a change to a file this fix does not own.
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
