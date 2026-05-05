"use client";

import { useState } from "react";

export function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-[3px] border border-rule bg-bg-card px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
    >
      {copied ? "Copied" : "Copy prompt"}
    </button>
  );
}
