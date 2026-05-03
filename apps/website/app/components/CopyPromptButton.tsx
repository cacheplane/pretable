"use client";

import { useState } from "react";

export interface CopyPromptButtonProps {
  prompt: string;
  className?: string;
}

export function CopyPromptButton({ prompt, className }: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex cursor-pointer items-center gap-2 rounded-[2px] border border-text-primary bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-text-primary",
    "transition-colors hover:bg-text-primary hover:text-bg-page",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label="Copy AI agent setup prompt"
      onClick={onClick}
    >
      {copied ? "✓ copied" : "[ Copy prompt ]"}
    </button>
  );
}
