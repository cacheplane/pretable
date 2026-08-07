"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  // Open-only by design: `html[data-drawer="open"] .drawer-handle` sets
  // `display: none !important`, so this button is unreachable once the drawer
  // is open. Closing is owned by NavBar's close button ("Show the grid"),
  // Escape, and browser back — all of which run useDrawer's `close()`, which
  // also clears the sessionStorage flag and strips the section hash. `toggle()`
  // does neither, so wiring it here would regress that bookkeeping.
  const { isOpen, open } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded={isOpen}
      className="drawer-handle w-full font-mono text-[12px] font-semibold uppercase tracking-[0.14em] transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={open}
      type="button"
    >
      ↑ Why pretable
    </button>
  );
}
