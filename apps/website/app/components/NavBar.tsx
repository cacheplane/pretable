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
      className="flex items-center justify-between gap-3 border-b border-rule-soft bg-bg-card/85 px-4 py-3 backdrop-blur-sm md:gap-5 md:px-10"
      role="banner"
    >
      <Link
        className="flex shrink-0 items-center gap-2 font-mono text-[13px]"
        href="/"
      >
        <span aria-hidden="true" className="text-accent">
          ●
        </span>
        <span className="font-semibold text-text-primary">pretable.ai</span>
      </Link>

      {mode === "drawer" && (
        <nav
          aria-label="Section navigation"
          className="hidden flex-1 items-center justify-center gap-5 font-mono text-[12px] text-text-muted md:flex"
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
        className="flex shrink-0 items-center gap-3 font-mono text-[12px] text-text-muted md:gap-5"
      >
        <Link className="hover:text-text-primary" href="/docs">
          /docs
        </Link>
        <a
          aria-label="GitHub"
          className="hidden hover:text-text-primary md:inline"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
        {mode === "drawer" && onClose && (
          <button
            aria-label="Show the grid"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border border-text-primary px-3 py-1 text-text-primary hover:bg-bg-raised"
            onClick={onClose}
            type="button"
          >
            <span className="hidden sm:inline">Show the grid </span>↓
          </button>
        )}
      </nav>
    </header>
  );
}
