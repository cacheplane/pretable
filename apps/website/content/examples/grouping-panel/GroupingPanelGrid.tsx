"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { type Position, positions } from "./data";

const VIEWPORT_HEIGHT = 340;

export function GroupingPanelGrid() {
  // The complete query is controlled so the current grouping levels can be
  // shown outside the grid. Omit both query props to let rows mode own it.
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<Position>>["query"]>
  >({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "desk" }],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Drag a header onto the strip to add a level · drag a chip to reorder · ✕
        or <kbd>Delete</kbd> removes one · click a ▾ to collapse a group
      </p>
      <PretableSurface<Position>
        ariaLabel="Positions grouped by desk"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        onQueryChange={setQuery}
        query={query}
        rows={positions}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Grouped by:{" "}
        <code>
          {query.rowGroups.length > 0
            ? query.rowGroups.map((entry) => entry.columnId).join(" → ")
            : "(nothing)"}
        </code>
      </p>
    </div>
  );
}
