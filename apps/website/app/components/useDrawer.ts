"use client";

import { useCallback, useEffect, useState } from "react";

const DRAWER_SECTIONS = new Set([
  "receipts",
  "compare",
  "how-it-works",
  "code",
  "features",
  "cta",
]);

const VIEWPORT_BREAKPOINT_PX = 768;

export interface UseDrawerResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useDrawer(): UseDrawerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpgraded, setIsUpgraded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < VIEWPORT_BREAKPOINT_PX) {
      return;
    }
    setIsUpgraded(true);

    const hash = window.location.hash.replace("#", "");
    if (hash && DRAWER_SECTIONS.has(hash)) {
      setIsOpen(true);
    }
  }, []);

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
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isUpgraded) return;
    const handler = (event: PopStateEvent) => {
      if (event.state?.drawer === "open") return;
      setIsOpen(false);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isUpgraded]);

  useEffect(() => {
    if (!isUpgraded || !isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isUpgraded, isOpen, close]);

  return { isOpen, open, close, toggle };
}
