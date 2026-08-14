"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { logLines, type LogLine } from "./data";

const VIEWPORT_HEIGHT = 220;

type Density = "compact" | "standard" | "spacious";
const TIERS: Density[] = ["compact", "standard", "spacious"];

export function DensityToggleGrid() {
  const [density, setDensity] = useState<Density>("standard");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [paddingX, setPaddingX] = useState("");
  const [rowPx, setRowPx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Padding is resolved by the cascade the moment React writes the new
    // attribute, so reading it here is already correct. Row height is not: the
    // engine learns about the swap from its own `MutationObserver`, which
    // delivers on a microtask after this layout effect has run, and re-renders
    // the rows from there. Measuring once would report the previous tier's
    // height. A `ResizeObserver` on the row reports whatever it settles at.
    let observed: HTMLElement | null = null;

    const read = (): void => {
      setPaddingX(
        getComputedStyle(wrapper)
          .getPropertyValue("--pretable-cell-padding-x")
          .trim(),
      );
      const row = wrapper.querySelector<HTMLElement>("[data-pretable-row]");
      if (!row) return;
      setRowPx(row.getBoundingClientRect().height);
      // Re-observing an already-observed element fires a fresh initial
      // callback, so only move the observer when the element itself changed.
      if (row !== observed) {
        observer.disconnect();
        observed = row;
        observer.observe(row);
      }
    };

    const observer = new ResizeObserver(read);
    read();

    return () => observer.disconnect();
  }, [density]);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The buttons set <code>data-density</code> on the wrapper{" "}
        <code>div</code> below, not on <code>&lt;html&gt;</code> — a docs-site
        adaptation so switching tiers doesn&apos;t resize every other grid on
        this page. Both numbers in the caption follow it.
      </p>
      <div role="radiogroup" aria-label="Density" style={{ marginBottom: 8 }}>
        {TIERS.map((tier) => (
          <button
            aria-pressed={density === tier}
            key={tier}
            onClick={() => setDensity(tier)}
            style={{
              marginRight: 8,
              fontWeight: density === tier ? 700 : 400,
            }}
            type="button"
          >
            {tier[0]!.toUpperCase()}
            {tier.slice(1)}
          </button>
        ))}
      </div>
      <div data-density={density} ref={wrapperRef}>
        <PretableSurface<LogLine>
          ariaLabel="Recent log lines"
          columns={columns}
          getRowId={(row) => row.id}
          rows={logLines}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        <code>--pretable-cell-padding-x</code> on the wrapper:{" "}
        <code>{paddingX || "…"}</code> — plain CSS inheritance, the browser
        resolving the token where it paints. Rendered row height:{" "}
        <code>{rowPx ?? "…"}px</code> — one of three tokens{" "}
        <a href="/docs/theming/density#the-engine-bridge">
          read by the engine in JavaScript
        </a>
        , resolved against the grid&apos;s own element rather than{" "}
        <code>document.documentElement</code>, which is the same question asked
        a different way. So both move together on every click, here and on your
        own <code>&lt;html&gt;</code>.
      </p>
    </div>
  );
}
