"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface CodeSurfaceProps {
  /**
   * Shown on the left of the header. Omitted (a fence with no `title=` meta)
   * leaves that side blank — the bar still renders, because it still hosts
   * the actions on the right; it just never renders a lone language tag.
   */
  filename?: string;
  /** Full source text. Used for the Copy action and the "N lines" label. */
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
   * Omitted renders the surface unconstrained — no fade, no line count, no
   * expand control. That's the fence path: fences have never had a height
   * problem, only examples do (48-252 line sources against a ~480px pane).
   */
  height?: number;
  /** Controlled: whether the surface is currently expanded past `height`. */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * Fires whenever overflow status or the content's natural (unclamped)
   * height changes. The natural height is `header height + content
   * scrollHeight` — what the caller needs to grow an ancestor pane to when
   * the reader expands.
   */
  onOverflowChange?: (overflowing: boolean, naturalHeight: number) => void;
  children: ReactNode;
}

/**
 * The one code surface shared by a fenced block (`CodeBlock`) and an
 * `<Example>`'s Code pane (`ExampleShell`): a header bar with file identity
 * on the left and actions on the right, then the code. See
 * docs/superpowers/specs/2026-08-14-docs-code-surface-design.md.
 */
export function CodeSurface({
  filename,
  raw,
  variant,
  showCopy = false,
  height,
  expanded = false,
  onToggleExpand,
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

  const lineCount = raw.split("\n").length;
  // Once expanded, the scroll region's own box grows to fit its content —
  // `overflowing` alone would flip back to false at that point (nothing left
  // to scroll to), which would yank the "Show less" control out from under
  // an expanded reader. `expanded` keeps both the label and the line count
  // in place for as long as the reader is looking at the expanded pane.
  const truncatable = height != null && (overflowing || expanded);
  const showLineCount = truncatable;
  const showFade = height != null && overflowing && !expanded;
  const showExpand = truncatable;

  const actionButtonClass =
    "whitespace-nowrap rounded-[3px] border border-rule bg-bg-card px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary";

  const header = (
    <div
      ref={headerRef}
      className="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-3 py-1.5 font-mono text-[11px] text-text-dim"
    >
      <span className="truncate">
        {filename}
        {filename && showLineCount ? " · " : ""}
        {showLineCount ? `${lineCount} lines` : ""}
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-1.5">
        {showCopy && (
          <button
            type="button"
            aria-label="Copy code"
            onClick={onCopy}
            className={actionButtonClass}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {showExpand && (
          <button
            type="button"
            onClick={onToggleExpand}
            className={actionButtonClass}
          >
            {expanded ? "Show less" : "Expand"}
          </button>
        )}
      </span>
    </div>
  );

  const code =
    variant === "fence" ? (
      <div className="docs-code-type overflow-x-auto px-4 py-3 font-mono">
        {children}
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
