"use client";

import type { ReactNode } from "react";

import { DrawerHandle } from "./DrawerHandle";
import { useDrawer } from "./useDrawer";

interface DrawerShellProps {
  children: ReactNode;
}

export function DrawerShell({ children }: DrawerShellProps) {
  // useDrawer is the source of truth for open/closed; call it here so the
  // hook's effects mount with the shell.
  useDrawer();
  return (
    <div className="drawer-shell" data-testid="drawer-shell">
      <DrawerHandle />
      <div
        aria-label="More about pretable"
        className="drawer-content overflow-y-auto bg-bg-page"
        id="drawer-content"
        role="region"
      >
        {children}
      </div>
    </div>
  );
}
