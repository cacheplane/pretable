"use client";

import type { ReactNode } from "react";

import { useDrawer } from "./useDrawer";

interface DrawerProps {
  children: ReactNode;
}

export function Drawer({ children }: DrawerProps) {
  const { close } = useDrawer();
  return (
    <div className="drawer-wrap" data-testid="drawer">
      <div
        aria-label="More about pretable"
        className="drawer-content overflow-y-auto bg-bg-page"
        id="drawer-content"
        role="region"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            Why pretable
          </span>
          <button
            aria-label="Close"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted hover:text-text-primary"
            onClick={close}
            type="button"
          >
            ✕ close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
