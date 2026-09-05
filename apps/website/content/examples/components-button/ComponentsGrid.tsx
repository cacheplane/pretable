"use client";

import { PretableSurface } from "@pretable/react";

import "./brand-button.css";

import { BrandButton } from "./BrandButton";
import { columns } from "./columns";
import { trades, type Trade } from "./data";

const VIEWPORT_HEIGHT = 260;

export function ComponentsGrid() {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Every button below is <code>BrandButton</code>, not pretable&apos;s —
        one <code>components</code> slot, applied in the tool panel, the header
        menus, and the portalled filter dialog alike. Open{" "}
        <strong>Filters</strong> for <code>+ filter</code> and{" "}
        <code>Clear</code>; open <strong>Columns</strong> for{" "}
        <strong>Reset columns</strong>, the one site <code>BrandButton</code>{" "}
        treats differently.
      </p>
      <PretableSurface<Trade>
        ariaLabel="Trades"
        columns={columns}
        components={{ Button: BrandButton }}
        getRowId={(row) => row.id}
        rows={trades}
        toolPanel={{ defaultActiveSection: "columns" }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
