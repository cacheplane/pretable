"use client";

import { useState } from "react";

import { useDensityHeights } from "./useDensityHeights";

type Density = "compact" | "standard" | "spacious";

const DENSITIES: readonly Density[] = ["compact", "standard", "spacious"];

export function DensityHeightsDemo() {
  const [density, setDensity] = useState<Density>("standard");
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);

  // The same hook twice, differing only in the element it is given. The
  // element is the whole of the scoping mechanism: `getDensityHeights` resolves
  // the tokens where that element paints, and the tokens inherit, so the boxed
  // wrapper's own `data-density` is what the first reading sees.
  const scoped = useDensityHeights(wrapper);

  // `null` means "no element", which resolves `document.documentElement` — this
  // docs page's real root, which the buttons below never touch.
  const page = useDensityHeights(null);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        These buttons set <code>data-density</code> on the boxed wrapper below,
        not on <code>&lt;html&gt;</code> — a docs-site adaptation so this demo
        does not re-theme the rest of the page. &quot;Boxed wrapper&quot; is the{" "}
        <code>useDensityHeights</code> recipe above given that element;
        &quot;Page root&quot; is the identical hook given <code>null</code>, so
        it reads the document root and stays constant no matter which button is
        pressed.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {DENSITIES.map((option) => (
          <button
            aria-pressed={option === density}
            key={option}
            onClick={() => setDensity(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <div
        data-density={density}
        ref={setWrapper}
        style={{
          background: "var(--pretable-bg-toolbar)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Reading</th>
              <th style={{ textAlign: "right" }}>Row height</th>
              <th style={{ textAlign: "right" }}>Header height</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Boxed wrapper (data-density=&quot;{density}&quot;)</td>
              <td style={{ textAlign: "right" }}>{scoped.rowHeight}px</td>
              <td style={{ textAlign: "right" }}>{scoped.headerHeight}px</td>
            </tr>
            <tr>
              <td>Page root (unaffected)</td>
              <td style={{ textAlign: "right" }}>{page.rowHeight}px</td>
              <td style={{ textAlign: "right" }}>{page.headerHeight}px</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
