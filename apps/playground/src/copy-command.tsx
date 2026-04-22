import { useState } from "react";
import { flushSync } from "react-dom";

export interface CopyCommandProps {
  command: string;
  className?: string;
}

export function CopyCommand({ command, className }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      flushSync(() => setCopied(true));
      setTimeout(() => flushSync(() => setCopied(false)), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex items-center gap-2 rounded-[2px] border border-ink bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-ink",
    "hover:bg-ink hover:text-cream-hi transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream",
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
