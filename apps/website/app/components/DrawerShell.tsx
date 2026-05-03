"use client";

import type { ReactNode } from "react";

import { useDrawer } from "./useDrawer";

interface DrawerShellProps {
  children: ReactNode;
}

export function DrawerShell({ children }: DrawerShellProps) {
  // useDrawer is the source of truth for open/closed; call it here so the
  // hook's effects mount with the shell. `position: fixed` on .drawer-shell
  // applies a transform; child elements with `position: fixed` would be
  // contained by that transform. The handle therefore lives OUTSIDE this
  // shell, rendered as a sibling in page.tsx.
  useDrawer();
  return (
    <div className="drawer-shell" data-testid="drawer-shell">
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
