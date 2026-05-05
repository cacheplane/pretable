"use client";

import { useState } from "react";

import type { ExampleDef } from "../../../../lib/docs/define-example";

export interface ExampleProps {
  example: ExampleDef;
  defaultOpen?: boolean;
  showLive?: boolean;
}

export function Example({
  example,
  defaultOpen = false,
  showLive = true,
}: ExampleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(0);
  const file = example.files[active];

  const copyFile = () => navigator.clipboard.writeText(file.source);
  const copyAll = () =>
    navigator.clipboard.writeText(
      example.files
        .map((f) => "```" + f.lang + " " + f.path + "\n" + f.source + "\n```")
        .join("\n\n") + "\n",
    );

  return (
    <figure className="my-6 rounded-md border border-rule">
      {showLive && (
        <div className="border-b border-rule bg-bg-card/40 p-4">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
            {example.title} — live
          </div>
          {example.Demo}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between border-b border-rule px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary hover:text-text-primary"
      >
        <span>{open ? "▾ Hide source" : "▸ Show source"}</span>
        <span className="text-text-dim">{example.files.length} files</span>
      </button>
      {open && (
        <div>
          <div
            role="tablist"
            className="flex border-b border-rule font-mono text-[11.5px]"
          >
            {example.files.map((f, i) => (
              <button
                key={f.path}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`px-3 py-2 ${i === active ? "text-accent" : "text-text-secondary hover:text-text-primary"}`}
              >
                {f.path}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 px-3">
              <button
                type="button"
                onClick={copyFile}
                className="font-mono text-[10px] text-text-secondary hover:text-text-primary"
              >
                Copy file
              </button>
              <button
                type="button"
                onClick={copyAll}
                className="font-mono text-[10px] text-accent hover:text-accent-deep"
              >
                Copy all
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55]">
            {file.source}
          </pre>
        </div>
      )}
    </figure>
  );
}
