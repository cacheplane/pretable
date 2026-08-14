import type { ReactNode } from "react";

export type CalloutType = "note" | "tip" | "warning" | "info" | "check";

const STYLES: Record<CalloutType, string> = {
  note: "border-l-text-dim bg-bg-card/50",
  tip: "border-l-accent bg-accent/8",
  warning: "border-l-amber-500 bg-amber-500/8",
  info: "border-l-sky-600 bg-sky-600/8",
  check: "border-l-emerald-600 bg-emerald-600/8",
};

const ICON: Record<CalloutType, string> = {
  note: "✎",
  tip: "★",
  warning: "⚠",
  info: "ℹ",
  check: "✓",
};

export function Callout({
  type = "note",
  children,
}: {
  type?: CalloutType;
  children: ReactNode;
}) {
  return (
    <aside
      role="note"
      className={`my-5 rounded-[4px] border border-rule border-l-2 p-4 text-[14px] ${STYLES[type]}`}
    >
      <div className="flex gap-3">
        <span aria-hidden="true" className="font-mono text-text-dim">
          {ICON[type]}
        </span>
        {/* `min-w-0` because a flex item defaults to `min-width: auto`, which
            is its min-content width — so one long inline token held this div
            41px wider than its column. Not sufficient on its own (the token
            then overflows the narrowed box instead; the fix that matters is
            `overflow-wrap: anywhere` on `.docs-prose code`), but it is the
            same idiom the shell already uses on `main.min-w-0` and the docs
            grid's `minmax(0,1fr)`, and this was the one flex container that
            missed it. */}
        <div className="prose-tight min-w-0">{children}</div>
      </div>
    </aside>
  );
}
