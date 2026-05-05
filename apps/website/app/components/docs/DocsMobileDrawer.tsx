"use client";

import { useEffect, useState, type ReactNode } from "react";

export function DocsMobileDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        aria-label="Menu"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 rounded-md border border-rule bg-bg-card px-3 py-2 font-mono text-[12px] shadow md:hidden"
      >
        Menu
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 overflow-y-auto border-r border-rule bg-bg-card p-6">
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="mb-4 font-mono text-[11px] text-text-dim"
            >
              ✕ Close
            </button>
            <div onClick={() => setOpen(false)}>{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
