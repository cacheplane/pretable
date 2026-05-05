"use client";

import { useState } from "react";

export function CopyPageButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const r = await fetch(path + ".md");
    const text = await r.text();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[3px] border border-rule bg-bg-card px-2.5 py-1 font-mono text-[11px] text-text-secondary hover:text-text-primary"
    >
      {copied ? "Copied" : "Copy as Markdown"}
    </button>
  );
}
