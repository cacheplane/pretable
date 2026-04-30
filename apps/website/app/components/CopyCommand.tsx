"use client";

import { useState } from "react";

export interface CopyCommandProps {
  command: string;
  className?: string;
}

export function CopyCommand({ command, className }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-text-primary",
    "hover:bg-bg-raised hover:text-bg-card transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label="Copy install command"
      onClick={onClick}
    >
      {copied ? "✓ copied" : `$ ${command}`}
    </button>
  );
}
