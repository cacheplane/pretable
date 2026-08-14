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
    if (!wrapperRef.current) return;
    setPaddingX(
      getComputedStyle(wrapperRef.current)
        .getPropertyValue("--pretable-cell-padding-x")
        .trim(),
    );
    const row = wrapperRef.current.querySelector<HTMLElement>(
      "[data-pretable-row]",
    );
    if (row) setRowPx(row.getBoundingClientRect().height);
  }, [density]);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The buttons set <code>data-density</code> on the wrapper{" "}
        <code>div</code> below, not on <code>&lt;html&gt;</code> — a docs-site
        adaptation, and this time an incomplete one. Watch what happens to the
        two numbers in the caption as you click.
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
        <code>{paddingX || "…"}</code> — updates every click, plain CSS
        inheritance. Rendered row height: <code>{rowPx ?? "…"}px</code> — does
        not move. Row height is one of three tokens{" "}
        <a href="/docs/theming/density#the-engine-bridge">
          read by the engine in JavaScript
        </a>{" "}
        off <code>document.documentElement</code>, not off whichever element
        carries the attribute — so only <code>&lt;html&gt;</code> counts for
        this one. In your own app, where <code>data-density</code> belongs on{" "}
        <code>&lt;html&gt;</code> anyway, this split is invisible; a
        wrapper-scoped docs demo is the one place it shows.
      </p>
    </div>
  );
}
