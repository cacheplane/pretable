"use client";

import { useState, type CSSProperties } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { products, type Product } from "./data";

const VIEWPORT_HEIGHT = 220;

// `--pretable-*` custom properties are ordinary CSS custom properties, so
// setting them via a React `style` object on one wrapper element scopes them
// to that element's subtree exactly the way a `:root` redefinition scopes
// them to the whole document — the only thing that changed is *which*
// element defines them. A real app writes these in a stylesheet at `:root`;
// this demo writes them inline on a wrapper `div` purely so toggling them
// doesn't also override every other grid on this docs page.
function overrideStyle(brand: boolean, sharp: boolean): CSSProperties {
  const style: Record<string, string> = {};
  if (brand) {
    style["--pretable-accent"] = "#7c3aed";
    style["--pretable-focus-ring"] = "#7c3aed";
  }
  if (sharp) {
    style["--pretable-radius"] = "2px";
  }
  return style as CSSProperties;
}

export function TokenOverrideGrid() {
  const [brand, setBrand] = useState(false);
  const [sharp, setSharp] = useState(false);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Both buttons redefine <code>--pretable-*</code> tokens on the wrapper{" "}
        <code>div</code> below, not at <code>:root</code> — a docs-site
        adaptation so toggling them doesn&apos;t also repaint every other grid
        on this page. A real app writes the same declarations in its own
        stylesheet at <code>:root</code>, after the theme import.
      </p>
      <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
        <button onClick={() => setBrand((v) => !v)} type="button">
          {brand ? "Remove" : "Override"} accent
        </button>
        <button onClick={() => setSharp((v) => !v)} type="button">
          {sharp ? "Remove" : "Override"} radius
        </button>
      </div>
      <div style={overrideStyle(brand, sharp)}>
        <PretableSurface<Product>
          ariaLabel="Products"
          columns={columns}
          getRowId={(row) => row.id}
          rows={products}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </div>
  );
}
