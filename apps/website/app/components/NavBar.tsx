"use client";

import Link from "next/link";

export type NavBarMode = "site" | "drawer";

export interface NavBarProps {
  mode: NavBarMode;
  onClose?: () => void;
}

const DRAWER_ANCHORS = [
  { id: "receipts", label: "Receipts" },
  { id: "compare", label: "Compare" },
  { id: "how-it-works", label: "How" },
  { id: "code", label: "Code" },
  { id: "features", label: "Features" },
] as const;

export function NavBar({ mode, onClose }: NavBarProps) {
  return (
    <header
      className="flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm md:px-10"
      role="banner"
    >
      <Link className="flex items-center gap-2 font-mono text-[13px]" href="/">
        <span aria-hidden="true" className="text-accent">
          ●
        </span>
        <span className="font-semibold text-text-primary">pretable.ai</span>
      </Link>

      {mode === "drawer" && (
        <nav
          aria-label="Section navigation"
          className="hidden items-center gap-5 font-mono text-[12px] text-text-muted md:flex"
        >
          {DRAWER_ANCHORS.map((anchor) => (
            <a
              className="hover:text-text-primary"
              href={`#${anchor.id}`}
              key={anchor.id}
            >
              {anchor.label}
            </a>
          ))}
        </nav>
      )}

      <nav
        aria-label="Site links"
        className="flex items-center gap-5 font-mono text-[12px] text-text-muted"
      >
        <Link className="hover:text-text-primary" href="/docs">
          /docs
        </Link>
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
        {mode === "drawer" && onClose && (
          <button
            className="inline-flex items-center gap-1 rounded-[4px] border border-text-primary px-3 py-1 text-text-primary hover:bg-bg-raised"
            onClick={onClose}
            type="button"
          >
            Show the grid ↓
          </button>
        )}
      </nav>
    </header>
  );
}
