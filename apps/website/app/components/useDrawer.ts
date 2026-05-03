"use client";

import { useCallback, useEffect, useState } from "react";

import { useControlState } from "./heroGrid/controlState";

const DRAWER_SECTIONS = new Set([
  "receipts",
  "compare",
  "how-it-works",
  "code",
  "features",
  "cta",
]);

export interface UseDrawerResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useDrawer(): UseDrawerResult {
  // isOpen is stored in controlState so all callers share a single source of truth.
  const { isDrawerOpen: isOpen, setIsDrawerOpen } = useControlState();
  const [isUpgraded, setIsUpgraded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Always upgrade post-hydration — no viewport-width gate.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time post-hydration upgrade
    setIsUpgraded(true);

    const hash = window.location.hash.replace("#", "");
    if (hash && DRAWER_SECTIONS.has(hash)) {
      setIsDrawerOpen(true);
    }
  }, [setIsDrawerOpen]);

  useEffect(() => {
    if (!isUpgraded) return;
    document.documentElement.setAttribute(
      "data-drawer",
      isOpen ? "open" : "closed",
    );
  }, [isOpen, isUpgraded]);

  const open = useCallback(() => {
    if (typeof window === "undefined") return;
    history.pushState({ drawer: "open" }, "");
    setIsDrawerOpen(true);
  }, [setIsDrawerOpen]);

  const close = useCallback(() => {
    setIsDrawerOpen(false);
    if (typeof window === "undefined") return;
    // If the URL still carries a drawer-section hash (e.g. /#receipts from a
    // deep-link or anchor click), strip it without adding a history entry so
    // a reload after "Show the grid" / Esc / close button stays on the grid.
    const hash = window.location.hash.replace("#", "");
    if (hash && DRAWER_SECTIONS.has(hash)) {
      history.replaceState(
        history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, [setIsDrawerOpen]);

  const toggle = useCallback(() => {
    setIsDrawerOpen(!isOpen);
  }, [isOpen, setIsDrawerOpen]);

  useEffect(() => {
    if (!isUpgraded) return;
    const handler = (event: PopStateEvent) => {
      if (event.state?.drawer === "open") return;
      setIsDrawerOpen(false);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isUpgraded, setIsDrawerOpen]);

  useEffect(() => {
    if (!isUpgraded || !isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isUpgraded, isOpen, close]);

  return { isOpen, open, close, toggle };
}
