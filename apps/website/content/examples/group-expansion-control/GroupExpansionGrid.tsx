"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { positions } from "./data";

const VIEWPORT_HEIGHT = 340;

export function GroupExpansionGrid() {
  // Two group levels from the start (desk, then sector), controlled so the
  // panel can still reorder or remove a level.
  const [query, setQuery] = useState<
    NonNullable<
      ComponentProps<
        typeof PretableSurface<(typeof positions)[number]>
      >["query"]
    >
  >({
    filters: [],
    sort: [],
    rowGroups: [
      { columnId: "desk", direction: "asc" },
      { columnId: "sector", direction: "asc" },
    ],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The <code>through-depth</code> expansion policy (depth 0) opens only the
        top level here — sector groups start collapsed. Click a ▾ twisty, or
        focus a group row and press <kbd>Arrow Right</kbd>, to expand a sector
        and see its positions.
      </p>
      <PretableSurface
        ariaLabel="Positions grouped by desk and sector, sector groups collapsed"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        initialExpansion={{ kind: "through-depth", depth: 0 }}
        onQueryChange={setQuery}
        query={query}
        rows={positions}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
