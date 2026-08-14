"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Languages whose tag would say nothing a reader can't already see. A `text`
 * fence names no language, so uppercasing it into "TEXT" would recreate the
 * empty-bar problem with extra ink. Everything else — ts, tsx, css, html,
 * bash, diff — names something real.
 */
const UNINFORMATIVE_LANGUAGES = new Set(["text", "plaintext", "plain", "txt"]);

export interface CodeSurfaceProps {
  /**
   * Identity shown on the left of the header. A fence gets it from `title="…"`
   * fence meta; an example passes its file path only when there is no file-tab
   * strip to name it (see `ExampleShell`), since the tabs already do.
   */
  filename?: string;
  /**
   * Fallback identity for a fence carrying no `title=`: the fence's own
   * language, drawn as a quiet uppercase label rather than a heading. Ignored
   * whenever `filename` is set — a real name always beats a language.
   */
  language?: string;
  /** Full source text. Used for the Copy action. */
  raw: string;
  /**
   * A fence renders its own padding and type-scale class on the code
   * wrapper (`children` is a bare `<code>`, with no `<pre>` to carry
   * either). An example's `children` is already a fully Shiki-rendered
   * `<pre>`, styled by `.pretable-example-code pre` in globals.css — this
   * surface must not double up on top of that.
   */
  variant: "fence" | "example";
  /**
   * Render the Copy action in this header. A fence owns its copy here — that
   * is the whole point of moving it off the floating button. An example's
   * per-file copy stays in `ExampleShell`'s outer action row, which already
   * puts it in a bar rather than floating it, so it isn't duplicated here.
   */
  showCopy?: boolean;
  /**
   * Fixed collapsed height, in px, for the code region below the header.
   * Omitted renders the surface unconstrained — no clamp, no fade. That's the
   * fence path: fences have never had a height problem, only examples do
   * (48-252 line sources against a ~480px pane).
   */
  height?: number;
  /**
   * Controlled: whether the surface is currently expanded past `height`. The
   * control that flips it lives in the caller's own toolbar, not in this
   * header — see `ExampleShell`.
   */
  expanded?: boolean;
  /**
   * Fires whenever overflow status or the content's natural (unclamped)
   * height changes. The natural height is `header height + content
   * scrollHeight` — what the caller needs to grow an ancestor pane to when
   * the reader expands. `overflowing` is what tells the caller whether to
   * offer an expand control at all.
   */
  onOverflowChange?: (overflowing: boolean, naturalHeight: number) => void;
  children: ReactNode;
}

/**
 * The one code surface shared by a fenced block (`CodeBlock`) and an
 * `<Example>`'s Code pane (`ExampleShell`): identity on the left of a header
 * bar, Copy on the right, then the code. See
 * docs/superpowers/specs/2026-08-14-docs-code-surface-design.md.
 *
 * The header is conditional, not decorative furniture — it appears only when
 * it has something to say (an identity, or a Copy button). Everything an
 * example wraps around this surface (its own tabs, its own toolbar, its own
 * expand control) stays in `ExampleShell`, so this component never has to
 * know how many files it is one of.
 */
export function CodeSurface({
  filename,
  language,
  raw,
  variant,
  showCopy = false,
  height,
  expanded = false,
  onOverflowChange,
  children,
}: CodeSurfaceProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current != null) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const onCopy = async () => {
    if (copyTimeoutRef.current != null) clearTimeout(copyTimeoutRef.current);
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  // Overflow is measured against the real box, not derived from the guard's
  // `--docs-code-size` x `--docs-code-leading` arithmetic: actual rendered
  // line height is what determines whether content overflows, and jsdom (the
  // guard runs in Node/jsdom, not a laid-out browser) can't produce that
  // number. Guarded for jsdom, which doesn't implement ResizeObserver — see
  // HeroGrid.tsx for the same pattern.
  useLayoutEffect(() => {
    if (height == null) return;
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const isOverflowing = el.scrollHeight > el.clientHeight + 1;
      setOverflowing(isOverflowing);
      onOverflowChange?.(
        isOverflowing,
        (headerRef.current?.offsetHeight ?? 0) + el.scrollHeight,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height, raw, onOverflowChange]);

  const showFade = height != null && overflowing && !expanded;

  const languageTag =
    language && !UNINFORMATIVE_LANGUAGES.has(language.toLowerCase())
      ? language
      : undefined;
  // A name always wins; the language is only the fallback. Drawing them
  // differently is the point: a filename is the thing's identity and reads as
  // written, while the language is a classification, so it gets the small
  // uppercase treatment this codebase already uses for quiet labels (see the
  // view tabs in ExampleShell) — a label on the bar, not a heading over the
  // code.
  const identity = filename ? (
    <span className="truncate">{filename}</span>
  ) : languageTag ? (
    <span className="truncate text-[10px] uppercase tracking-[0.12em]">
      {languageTag}
    </span>
  ) : null;

  // No identity and no actions means an empty bar, and an empty bar is pure
  // cost: it was ~31px of border and background saying nothing above every
  // multi-file example's code. Render nothing instead. A fence always has at
  // least Copy, so a fence always keeps its bar.
  const hasHeader = identity != null || showCopy;

  const header = hasHeader ? (
    <div
      ref={headerRef}
      className="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-1.5 font-mono text-[11px] text-text-dim"
    >
      {identity}
      {showCopy && (
        <button
          type="button"
          aria-label="Copy code"
          onClick={onCopy}
          className="ml-auto shrink-0 whitespace-nowrap rounded-[3px] border border-rule bg-bg-card px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  ) : null;

  // The `<pre>` is load-bearing, not decorative. `MdxRenderer`'s `Pre` mapping
  // hands this surface rehype-pretty-code's `<code>` and drops the `<pre>` that
  // wrapped it, so nothing downstream supplies `white-space: pre` — every
  // fence rendered with its leading indentation collapsed, because the `<code>`
  // is `display: grid` (one row per line), so lines still broke correctly and
  // only the indent silently vanished. An example's `children` is already a
  // full `<pre>`, which is why examples were never affected.
  const code =
    variant === "fence" ? (
      <div className="overflow-x-auto">
        <pre className="docs-code-type m-0 px-4 py-3 font-mono">{children}</pre>
      </div>
    ) : (
      children
    );

  if (height == null) {
    return (
      <div className="flex flex-col">
        {header}
        {code}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className={expanded ? "overflow-visible" : "h-full overflow-auto"}
        >
          {code}
        </div>
        {showFade && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8"
            style={{
              background:
                "linear-gradient(to top, var(--pt-bg-card), transparent)",
            }}
          />
        )}
      </div>
    </div>
  );
}
