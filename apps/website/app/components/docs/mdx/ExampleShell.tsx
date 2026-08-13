"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface ShellFile {
  path: string;
  lang: string;
  source: string;
  html: string;
}

export interface ExampleShellProps {
  title: string;
  description: string;
  height: number;
  files: readonly ShellFile[];
  agentMarkdown: string;
  mdHref: string;
  initial: "preview" | "code";
  children?: ReactNode;
}

export function ExampleShell({
  title,
  description,
  height,
  files,
  agentMarkdown,
  mdHref,
  initial,
  children,
}: ExampleShellProps) {
  const hasDemo = children != null;
  const [view, setView] = useState<"preview" | "code">(
    hasDemo ? initial : "code",
  );
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const fileTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const file = files[active];

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const onFileTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + files.length) % files.length;
    setActive(next);
    fileTabRefs.current[next]?.focus();
  };

  return (
    <figure className="my-6 overflow-hidden rounded-md border border-rule bg-bg-card">
      <div className="border-b border-rule px-3 py-2.5">
        <div className="text-[13px] font-semibold text-text-primary">
          {title}
        </div>
        <p className="mt-0.5 text-[12px] leading-[1.45] text-text-secondary">
          {description}
        </p>
      </div>

      <div className="flex items-center border-b border-rule bg-bg-card/40 px-2">
        <div role="tablist" aria-label="Example view" className="flex">
          {hasDemo && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              aria-controls="example-preview-pane"
              id="example-tab-preview"
              tabIndex={view === "preview" ? 0 : -1}
              onClick={() => setView("preview")}
              className={`border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
                view === "preview"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={view === "code"}
            aria-controls="example-code-pane"
            id="example-tab-code"
            tabIndex={view === "code" ? 0 : -1}
            onClick={() => setView("code")}
            className={`border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
              view === "code"
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Code
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5 py-1.5">
          {view === "code" && (
            <button
              type="button"
              onClick={() => copy("file", file.source)}
              className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
            >
              {copied === "file" ? "Copied" : "Copy file"}
            </button>
          )}
          <button
            type="button"
            onClick={() => copy("agent", agentMarkdown)}
            className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            {copied === "agent" ? "Copied" : "Copy for agent"}
          </button>
          <a
            href={mdHref}
            className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            .md
          </a>
        </div>
      </div>

      {view === "code" && files.length > 1 && (
        <div
          role="tablist"
          aria-label="Example files"
          className="flex border-b border-rule px-2"
        >
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              role="tab"
              id={`example-file-tab-${i}`}
              aria-controls="example-code-pane"
              ref={(el) => {
                fileTabRefs.current[i] = el;
              }}
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              onKeyDown={(e) => onFileTabKey(e, i)}
              onClick={() => setActive(i)}
              className={`border-b-2 px-2.5 py-1.5 font-mono text-[10.5px] ${
                i === active
                  ? "border-rule-strong text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}

      {/*
        Both panes stay mounted and laid out at all times. The inactive one is
        faded out (opacity-0 + pointer-events-none) and made inert, rather than
        unmounted or `display: none`-d, for two reasons that are both real:
        unmounting would reset a demo grid the reader has already grouped,
        scrolled, or selected in; and `display: none` gives a virtualized grid
        a zero-height container to measure against, which is a live layout
        hazard in this codebase. Do not "simplify" this to a single
        conditionally-rendered pane.
      */}
      <div
        data-example-pane
        className="relative overflow-hidden"
        style={{ height }}
      >
        {hasDemo && (
          <div
            id="example-preview-pane"
            role="tabpanel"
            aria-labelledby="example-tab-preview"
            className={`absolute inset-0 overflow-auto p-3 transition-opacity ${
              view === "preview"
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
            aria-hidden={view !== "preview"}
            inert={view !== "preview" ? true : undefined}
          >
            {children}
          </div>
        )}
        <div
          id="example-code-pane"
          role="tabpanel"
          aria-labelledby="example-tab-code"
          className={`pretable-example-code absolute inset-0 overflow-auto ${
            view === "code" ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={view !== "code"}
          inert={view !== "code" ? true : undefined}
          dangerouslySetInnerHTML={{ __html: file.html }}
        />
      </div>
    </figure>
  );
}
