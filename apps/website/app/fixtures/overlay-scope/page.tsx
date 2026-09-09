"use client";

import {
  PretableOverlayProvider,
  PretableSelect,
  PretableSurface,
  type PretableColumn,
} from "@pretable/react";
import { useState, type CSSProperties } from "react";

const OPTIONS = [
  { value: "alpha", label: "Alpha" },
  { value: "beta", label: "Beta" },
  { value: "gamma", label: "Gamma" },
  { value: "disabled", label: "Unavailable", disabled: true },
];
const ROWS = [
  { id: "one", name: "Alpha" },
  { id: "two", name: "Beta" },
];
const getRowId = (row: (typeof ROWS)[number]) => row.id;
const COLUMNS: PretableColumn<(typeof ROWS)[number]>[] = [
  { id: "name", header: "Name", type: "text", widthPx: 300 },
];

function Scope({
  name,
  initiallyDark,
}: {
  name: string;
  initiallyDark: boolean;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [dark, setDark] = useState(initiallyDark);
  const [rtl, setRtl] = useState(initiallyDark);
  const [first, setFirst] = useState("alpha");
  const [second, setSecond] = useState("beta");
  const scopeStyle = {
    "--pretable-bg-grid": dark ? "rgb(17, 34, 51)" : "rgb(240, 248, 255)",
    "--pretable-bg-grid-alt": dark ? "rgb(17, 34, 51)" : "rgb(240, 248, 255)",
    "--pretable-text-cell": dark ? "rgb(255, 248, 220)" : "rgb(20, 40, 60)",
    "--pretable-rule-strong": dark ? "rgb(150, 180, 210)" : "rgb(50, 70, 90)",
    colorScheme: dark ? "dark" : "light",
    padding: 16,
    border: "1px solid #888",
  } as CSSProperties;
  return (
    <section
      data-overlay-scope={name}
      data-theme={dark ? "dark" : "light"}
      dir={rtl ? "rtl" : "ltr"}
      style={scopeStyle}
    >
      <h2>{name}</h2>
      <button type="button" onClick={() => setDark((value) => !value)}>
        Toggle {name} theme
      </button>{" "}
      <button type="button" onClick={() => setRtl((value) => !value)}>
        Toggle {name} direction
      </button>
      <PretableOverlayProvider container={host}>
        <div
          data-scope-clip=""
          style={{
            contain: "content",
            overflow: "hidden",
            height: 190,
            marginTop: 12,
          }}
        >
          <PretableSurface
            ariaLabel={`${name} grid`}
            columns={COLUMNS}
            rows={ROWS}
            getRowId={getRowId}
            viewportHeight={132}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <PretableSelect
              aria-label={`${name} first`}
              options={OPTIONS}
              value={first}
              onChange={setFirst}
            />
            <PretableSelect
              aria-label={`${name} second`}
              options={OPTIONS}
              value={second}
              onChange={setSecond}
            />
          </div>
        </div>
      </PretableOverlayProvider>
      <div ref={setHost} data-overlay-host={name} />
    </section>
  );
}

export default function OverlayScopeFixture() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Scoped overlay fixture</h1>
      <button type="button" onPointerDown={(event) => event.stopPropagation()}>
        Outside with stopped bubbling
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 24,
          marginTop: 24,
        }}
      >
        <Scope name="Morning" initiallyDark={false} />
        <Scope name="Evening" initiallyDark />
      </div>
    </main>
  );
}
