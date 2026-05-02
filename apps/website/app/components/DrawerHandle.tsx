"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  const { isOpen, toggle } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded={isOpen ? "true" : "false"}
      className="block w-full bg-drawer-bg py-4 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-drawer-text transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={toggle}
      type="button"
    >
      {isOpen ? "↓ Close" : "↑ Learn more"}
    </button>
  );
}
