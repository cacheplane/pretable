import type { ReactNode } from "react";

import { CopyPromptButton } from "../CopyPromptButton";

function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flattenText(
      (node as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

export function Prompt({ children }: { children: ReactNode }) {
  const text = flattenText(children).trim();
  return (
    <aside className="my-6 rounded-md border border-rule border-l-2 border-l-accent bg-accent/8 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
          Prompt
        </span>
        <CopyPromptButton text={text} />
      </div>
      <div className="whitespace-pre-wrap font-mono text-[13px] leading-[1.55] text-text-secondary">
        {children}
      </div>
    </aside>
  );
}
