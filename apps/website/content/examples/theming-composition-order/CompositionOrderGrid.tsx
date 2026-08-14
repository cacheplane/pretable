"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { alerts, type Alert } from "./data";

const VIEWPORT_HEIGHT = 200;

// `data-theme="dark"` is scoped to the wrapper below (not `<html>`) purely so
// this one demo goes dark without repainting the rest of the docs page — see
// [Light / dark switching](/docs/theming/light-dark). The accent override
// below is inline `style` on the same wrapper for the same reason a real app
// would write it in a `:root` block: both resolve after the theme, on the
// same element, so both beat the theme regardless of which mode is active.
function overrideStyle(overridden: boolean): CSSProperties {
  return overridden
    ? ({ "--pretable-accent": "#ff5722" } as CSSProperties)
    : {};
}

export function CompositionOrderGrid() {
  const [dark, setDark] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [resolvedAccent, setResolvedAccent] = useState("");

  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    setResolvedAccent(
      getComputedStyle(wrapperRef.current)
        .getPropertyValue("--pretable-accent")
        .trim(),
    );
  }, [dark, overridden]);

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
        <button onClick={() => setDark((v) => !v)} type="button">
          Switch to {dark ? "light" : "dark"}
        </button>
        <button onClick={() => setOverridden((v) => !v)} type="button">
          {overridden ? "Remove" : "Add"} accent override
        </button>
      </div>
      <div
        data-theme={dark ? "dark" : undefined}
        ref={wrapperRef}
        style={{
          background: "var(--pretable-bg-toolbar)",
          borderRadius: 12,
          padding: 12,
          ...overrideStyle(overridden),
        }}
      >
        <PretableSurface<Alert>
          ariaLabel="Alerts"
          columns={columns}
          getRowId={(row) => row.id}
          rows={alerts}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Resolved <code>--pretable-accent</code>: <code>{resolvedAccent}</code>.
        The override applies in both modes — toggle dark mode with the override
        on and the color doesn&apos;t change back to the theme's.
      </p>
    </div>
  );
}
