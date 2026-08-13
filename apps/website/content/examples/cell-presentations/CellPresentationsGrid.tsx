"use client";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { positions, type Position } from "./data";

const VIEWPORT_HEIGHT = 260;

export function CellPresentationsGrid() {
  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        <strong>Position</strong> is a <code>PretableEntity</code>,{" "}
        <strong>Day P&amp;L</strong> a <code>PretableDelta</code>,{" "}
        <strong>Settlement</strong> a <code>PretableStatus</code>, and{" "}
        <strong>Flag</strong> a <code>PretableBadge</code> — none of the four
        speaks in colour alone.
      </p>
      <PretableSurface<Position>
        ariaLabel="Positions"
        columns={columns}
        getRowId={(row) => row.id}
        rows={positions}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
