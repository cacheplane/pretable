"use client";

import { PretableSurface } from "@pretable/react";

import "./brand.css";

import { columns } from "./columns";
import { shipments, type Shipment } from "./data";

const VIEWPORT_HEIGHT = 220;

export function CustomThemeGrid() {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        This grid is themed by <code>brand.css</code>, not{" "}
        <code>pretable.css</code>. Its tokens are scoped to the{" "}
        <code>.custom-theme-demo</code> wrapper below — a docs-site adaptation
        so the theme stays contained to this one demo instead of overriding
        every grid on the page. A real app defines these same tokens at a bare{" "}
        <code>:root</code>, as &quot;Custom themes&quot; describes.
      </p>
      <div className="custom-theme-demo">
        <PretableSurface<Shipment>
          ariaLabel="Shipments"
          columns={columns}
          getRowId={(row) => row.id}
          rows={shipments}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </div>
  );
}
