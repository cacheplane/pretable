"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  const { open } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded="false"
      className="drawer-handle w-full font-mono text-[12px] font-semibold uppercase tracking-[0.14em] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={open}
      type="button"
    >
      ↑ Why pretable
    </button>
  );
}
