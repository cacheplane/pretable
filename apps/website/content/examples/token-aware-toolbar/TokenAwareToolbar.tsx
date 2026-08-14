"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import "./toolbar.css";

import { columns } from "./columns";
import { metrics, type Metric } from "./data";

const VIEWPORT_HEIGHT = 160;

export function TokenAwareToolbar() {
  const [dark, setDark] = useState(false);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The toolbar strip is plain CSS reading <code>var(--pretable-*)</code>{" "}
        directly — no Tailwind bridge involved. Flip dark mode (scoped to the
        wrapper below, same adaptation as the other demos on this page) and the
        toolbar repaints with the grid, from the same custom properties, because
        both read the same live values.
      </p>
      <button
        onClick={() => setDark((v) => !v)}
        style={{ marginBottom: 8 }}
        type="button"
      >
        Switch to {dark ? "light" : "dark"}
      </button>
      <div data-theme={dark ? "dark" : undefined}>
        <div className="token-aware-toolbar">
          Latency dashboard ·{" "}
          <span className="token-aware-toolbar-accent">live</span>
        </div>
        <PretableSurface<Metric>
          ariaLabel="Metrics"
          columns={columns}
          getRowId={(row) => row.id}
          rows={metrics}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </div>
  );
}
