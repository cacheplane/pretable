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
        Every labelled button below is <code>BrandButton</code>; the icon
        buttons — the funnels, the ⋮ menus — are still pretable&apos;s, because
        this demo replaces only <code>Button</code>. Reset columns is the
        app&apos;s danger button (it branches on <code>site</code>); the Filters
        section&apos;s <code>+ filter</code> / <code>+ group</code> are its
        ghost buttons; a column funnel&apos;s dialog has its link-styled{" "}
        <code>Clear</code>.
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
