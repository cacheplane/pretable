"use client";

import { useState, type ReactNode } from "react";

export interface CodeBlockProps {
  children: ReactNode;
  raw: string;
  filename?: string;
  lang?: string;
}

export function CodeBlock({ children, raw, filename, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <figure className="relative my-6 rounded-md border border-rule bg-bg-card">
      {(filename || lang) && (
        <figcaption className="flex items-center justify-between border-b border-rule px-3 py-1.5 font-mono text-[11px] text-text-dim">
          <span>{filename ?? ""}</span>
          {lang && <span className="uppercase tracking-[0.1em]">{lang}</span>}
        </figcaption>
      )}
      <button
        type="button"
        aria-label="Copy code"
        onClick={onCopy}
        className="absolute right-2 top-2 rounded-[3px] border border-rule bg-bg-card px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <div className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-[1.55]">
        {children}
      </div>
    </figure>
  );
}
