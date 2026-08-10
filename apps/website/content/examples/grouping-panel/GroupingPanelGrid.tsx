"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { type Position, positions } from "./data";

const VIEWPORT_HEIGHT = 340;

export function GroupingPanelGrid() {
  // Grouping is controlled here so the current levels can be shown outside the
  // grid. Uncontrolled works too — drop `state` and `onRowGroupsChange` and the
  // engine owns the list.
  const [rowGroups, setRowGroups] = useState<string[]>(["desk"]);

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
        onRowGroupsChange={setRowGroups}
        rows={positions}
        state={{ rowGroups }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Grouped by:{" "}
        <code>
          {rowGroups.length > 0 ? rowGroups.join(" → ") : "(nothing)"}
        </code>
      </p>
    </div>
  );
}
