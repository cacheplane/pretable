"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { positions } from "./data";

const VIEWPORT_HEIGHT = 340;

export function WeightedAverageGrid() {
  // Grouped by desk from the start, but the query stays controlled so the
  // grouping panel can still regroup or ungroup interactively.
  const [query, setQuery] = useState<
    NonNullable<
      ComponentProps<
        typeof PretableSurface<(typeof positions)[number]>
      >["query"]
    >
  >({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "desk", direction: "asc" }],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Grouped by desk. <strong>Avg price</strong> is the built-in{" "}
        <code>&quot;avg&quot;</code> preset; <strong>VWAP</strong> is the custom
        reducer above, weighted by <strong>Shares</strong> — compare the two
        numbers on a group row to see the weighting actually change the result,
        not just relabel it. Drag <strong>Sector</strong> onto the panel to add
        a second level.
      </p>
      <PretableSurface
        ariaLabel="Positions grouped by desk, comparing plain and weighted average price"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        onQueryChange={setQuery}
        query={query}
        rows={positions}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
