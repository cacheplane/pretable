"use client";

import { useRef, useState, type ReactNode } from "react";

export interface CodeBlockTab {
  label: string;
  content: ReactNode;
}

export interface CodeBlockProps {
  /** Single-snippet label shown in the header (mutually exclusive with `tabs`). */
  label?: string;
  /** Multi-snippet tabs. When provided, `label` and `children` are ignored. */
  tabs?: CodeBlockTab[];
  /** Body content when not using `tabs`. */
  children?: ReactNode;
  className?: string;
}

export function CodeBlock({
  label,
  tabs,
  children,
  className,
}: CodeBlockProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);

  const classes = ["pt-code-block", className].filter(Boolean).join(" ");

  const onCopy = async () => {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts. Silent no-op is fine —
      // the user can still select + copy manually.
    }
  };

  return (
    <div className={classes}>
      <div className="pt-code-head">
        <div className="pt-code-tabs">
          {tabs ? (
            tabs.map((tab, i) => {
              const tabClasses = [
                "pt-code-tab",
                i === activeIdx ? "active" : null,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={tab.label}
                  type="button"
                  className={tabClasses}
                  onClick={() => setActiveIdx(i)}
                >
                  {tab.label}
                </button>
              );
            })
          ) : label ? (
            <span className="pt-code-tab active">{label}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="pt-code-copy"
          onClick={onCopy}
          aria-label="Copy code"
        >
          {copied ? "✓ copied" : "⎘ copy"}
        </button>
      </div>
      <pre ref={preRef} className="pt-code-body">
        {tabs ? tabs[activeIdx]?.content : children}
      </pre>
    </div>
  );
}
