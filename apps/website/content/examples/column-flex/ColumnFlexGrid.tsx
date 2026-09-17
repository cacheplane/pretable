"use client";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { tickets, type Ticket } from "./data";

const VIEWPORT_HEIGHT = 260;

export function ColumnFlexGrid() {
  return (
    <div>
      <PretableSurface<Ticket>
        ariaLabel="Column flex"
        columns={columns}
        getRowId={(row) => row.id}
        rows={tickets}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Key and Status are fixed; Summary and Owner share the rest 2:1, and
        Owner never goes under 110px.
      </p>
    </div>
  );
}
