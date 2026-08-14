"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface CodeSurfaceProps {
  /**
   * Shown on the left of the header. Omitted (a fence with no `title=` meta)
   * leaves that side blank — the bar still renders, because it still hosts
   * the actions on the right; it just never renders a lone language tag.
   */
  filename?: string;
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
  children,
}: CodeSurfaceProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const actionButtonClass =
    "whitespace-nowrap rounded-[3px] border border-rule bg-bg-card px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary";

  return (
    <div className="flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-rule px-3 py-1.5 font-mono text-[11px] text-text-dim">
        <span className="truncate">{filename}</span>
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
        </span>
      </div>
      {variant === "fence" ? (
        <div className="docs-code-type overflow-x-auto px-4 py-3 font-mono">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
