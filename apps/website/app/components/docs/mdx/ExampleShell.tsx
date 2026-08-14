"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useInView } from "../../showcase/useInView";
import { CodeSurface } from "./CodeSurface";

export interface ShellFile {
  path: string;
  lang: string;
  source: string;
  html: string;
}

export interface ExampleShellProps {
  title: string;
  description: string;
  height: number;
  files: readonly ShellFile[];
  agentMarkdown: string;
  mdHref: string;
  initial: "preview" | "code";
  children?: ReactNode;
}

const NAV_KEYS = ["ArrowRight", "ArrowLeft", "Home", "End"] as const;
type NavKey = (typeof NAV_KEYS)[number];

function isNavKey(key: string): key is NavKey {
  return (NAV_KEYS as readonly string[]).includes(key);
}

/**
 * Shared APG roving-tabindex arithmetic for both tablists below (view, and
 * file). Left/Right wrap around; Home/End jump to the ends — all four are
 * part of the APG tab pattern, not just Left/Right.
 */
function nextTabIndex(current: number, count: number, key: NavKey): number {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }
}

export function ExampleShell({
  title,
  description,
  height,
  files,
  agentMarkdown,
  mdHref,
  initial,
  children,
}: ExampleShellProps) {
  const hasDemo = children != null;
  const [view, setView] = useState<"preview" | "code">(
    hasDemo ? initial : "code",
  );
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const fileTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ids are unique per mounted instance (React 19's useId is SSR-stable), so
  // two <Example>s on the same page never collide. Before this, literal ids
  // meant every aria-labelledby/aria-controls past the first example on a
  // page resolved — via getElementById — to the FIRST example's elements.
  const uid = useId();
  const previewTabId = `${uid}-tab-preview`;
  const codeTabId = `${uid}-tab-code`;
  const previewPaneId = `${uid}-preview-pane`;
  const codePaneId = `${uid}-code-pane`;
  const fileTabId = (i: number) => `${uid}-file-tab-${i}`;

  const viewOrder = hasDemo
    ? (["preview", "code"] as const)
    : (["code"] as const);

  const file = files[active];

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current != null) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const copy = async (label: string, text: string) => {
    if (copyTimeoutRef.current != null) clearTimeout(copyTimeoutRef.current);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      // A non-secure context (e.g. checking the docs over http:// on a
      // phone, on the LAN) leaves `navigator.clipboard` undefined; Safari
      // and Firefox can also reject writeText outright. Either way "Copy for
      // agent" is a headline feature — a silent no-op is the worst outcome,
      // so a failed copy gets its own visible label rather than looking
      // identical to success or to doing nothing.
      setCopied(`${label}-failed`);
    }
    // Owned by this single ref so a second copy click doesn't race the
    // first: without clearing the previous timeout above, clicking Copy
    // file then Copy for agent within 2s lets the first timer fire late and
    // wipe the second button's "Copied" out from under it.
    copyTimeoutRef.current = setTimeout(() => setCopied(null), 2000);
  };

  const copyLabel = (base: string, action: string) => {
    if (copied === action) return "Copied";
    if (copied === `${action}-failed`) return "Copy failed";
    return base;
  };

  const selectView = (next: "preview" | "code", index: number) => {
    setView(next);
    // Marking the pane being left `inert` will forcibly blur any focus
    // still inside it (e.g. a reader who tabbed into the demo grid). Move
    // focus to the tab explicitly rather than relying on the browser's
    // default click-to-focus behavior, which Safari doesn't apply to
    // buttons — matches the APG tab pattern anyway (activating a tab moves
    // focus to it).
    viewTabRefs.current[index]?.focus();
  };

  const onViewTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    const next = nextTabIndex(index, viewOrder.length, e.key);
    selectView(viewOrder[next], next);
  };

  const selectFile = (index: number) => {
    setActive(index);
    fileTabRefs.current[index]?.focus();
  };

  const onFileTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    selectFile(nextTabIndex(index, files.length, e.key));
  };

  // One-shot latch: the demo mounts the first time its pane is both scrolled
  // into view AND selected — not at ExampleShell mount time. Before this, a
  // demo whose children ran a timer or animation on mount (e.g. the
  // homepage's streaming chat grid) finished inside the *hidden* pane before
  // a reader ever selected Preview, since both panes have always stayed
  // mounted (see the layout comment below). Requiring "selected" too means a
  // page that opens straight to Code (CodeExample passes initial="code")
  // doesn't burn the demo's one performance before anyone can see it.
  const [previewPaneRef, inView] = useInView<HTMLDivElement>();
  const [demoMounted, setDemoMounted] = useState(false);
  // Adjusted during render, not in an effect: this is "store information
  // from previous renders" (react.dev/reference/react/useState#storing-
  // information-from-previous-renders), not a synchronization effect. The
  // `!demoMounted` guard makes it fire at most once — React re-renders
  // immediately with the new value instead of committing the stale one, so
  // there's no extra flash of the un-mounted demo.
  if (!demoMounted && inView && view === "preview") {
    setDemoMounted(true);
  }

  return (
    <figure className="my-6 overflow-hidden rounded-md border border-rule bg-bg-card">
      <div className="border-b border-rule px-3 py-2.5">
        <div className="text-[13px] font-semibold text-text-primary">
          {title}
        </div>
        <p className="mt-0.5 text-[12px] leading-[1.45] text-text-secondary">
          {description}
        </p>
      </div>

      <div className="flex flex-nowrap items-center overflow-x-auto border-b border-rule bg-bg-card/40 px-2">
        <div role="tablist" aria-label="Example view" className="flex shrink-0">
          {hasDemo && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              aria-controls={previewPaneId}
              id={previewTabId}
              tabIndex={view === "preview" ? 0 : -1}
              ref={(el) => {
                viewTabRefs.current[0] = el;
              }}
              onKeyDown={(e) => onViewTabKey(e, 0)}
              onClick={() => selectView("preview", 0)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
                view === "preview"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={view === "code"}
            aria-controls={codePaneId}
            id={codeTabId}
            tabIndex={view === "code" ? 0 : -1}
            ref={(el) => {
              viewTabRefs.current[hasDemo ? 1 : 0] = el;
            }}
            onKeyDown={(e) => onViewTabKey(e, hasDemo ? 1 : 0)}
            onClick={() => selectView("code", hasDemo ? 1 : 0)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
              view === "code"
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Code
          </button>
        </div>

        <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-1.5 py-1.5">
          {view === "code" && (
            <button
              type="button"
              onClick={() => copy("file", file.source)}
              className="whitespace-nowrap rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
            >
              {copyLabel("Copy file", "file")}
            </button>
          )}
          <button
            type="button"
            onClick={() => copy("agent", agentMarkdown)}
            className="whitespace-nowrap rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            {copyLabel("Copy for agent", "agent")}
          </button>
          <a
            href={mdHref}
            className="whitespace-nowrap rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            .md
          </a>
        </div>
      </div>

      {view === "code" && files.length > 1 && (
        <div
          role="tablist"
          aria-label="Example files"
          className="flex flex-nowrap overflow-x-auto border-b border-rule px-2"
        >
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              role="tab"
              id={fileTabId(i)}
              aria-controls={codePaneId}
              ref={(el) => {
                fileTabRefs.current[i] = el;
              }}
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              onKeyDown={(e) => onFileTabKey(e, i)}
              onClick={() => selectFile(i)}
              className={`whitespace-nowrap border-b-2 px-2.5 py-1.5 font-mono text-[10.5px] ${
                i === active
                  ? "border-text-primary text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}

      {/*
        Both panes stay mounted and laid out at all times. The inactive one is
        faded out (opacity-0 + pointer-events-none) and made inert, rather than
        unmounted or `display: none`-d, for two reasons that are both real:
        unmounting would reset a demo grid the reader has already grouped,
        scrolled, or selected in; and `display: none` gives a virtualized grid
        a zero-height container to measure against, which is a live layout
        hazard in this codebase. Do not "simplify" this to a single
        conditionally-rendered pane.

        React 19.2's <Activity mode="hidden"> is not a substitute: it hides
        via `display: none` (the exact hazard above) and unmounts effects
        while hidden — the opposite of what keeps a grid's state alive here.

        The demo itself still only mounts once (see `demoMounted` above), so
        staying mounted doesn't mean running unseen from page load — it means
        never resetting once a reader has actually looked at it.
      */}
      <div
        data-example-pane
        ref={previewPaneRef}
        className="relative overflow-hidden"
        style={{ height }}
      >
        {hasDemo && (
          <div
            id={previewPaneId}
            role="tabpanel"
            aria-labelledby={previewTabId}
            className={`absolute inset-0 overflow-auto p-3 transition-opacity ${
              view === "preview"
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            aria-hidden={view !== "preview"}
            inert={view !== "preview" ? true : undefined}
          >
            {demoMounted && children}
          </div>
        )}
        <div
          id={codePaneId}
          role="tabpanel"
          aria-labelledby={codeTabId}
          className={`pretable-example-code absolute inset-0 overflow-auto transition-opacity ${
            view === "code" ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={view !== "code"}
          inert={view !== "code" ? true : undefined}
        >
          <CodeSurface filename={file.path} raw={file.source} variant="example">
            <div dangerouslySetInnerHTML={{ __html: file.html }} />
          </CodeSurface>
        </div>
      </div>
    </figure>
  );
}
