"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { holdings, type Holding } from "./data";

const VIEWPORT_HEIGHT = 380;

export function GroupingSectionGrid() {
  // The query is controlled only to seed one grouping level on load; the
  // setter hands every later write straight back, so the pane's group-by
  // list, the drag-to-group strip, and this prop stay one model.
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<Holding>>["query"]>
  >({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "desk" }],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The Grouping pane is open on load, with rows already grouped by{" "}
        <strong>Desk</strong>. <strong>+ Add group</strong> adds{" "}
        <strong>Sector</strong> as a second level; drag a grip to reorder the
        levels, and ✕ removes one — the strip above the header shows every
        change, because both are projections of one model. Flip{" "}
        <strong>Hide grouped columns</strong> to keep the grouped column in the
        body, and change <strong>Market value</strong>&apos;s aggregate — its{" "}
        <strong>Default (Sum)</strong> is the prop&apos;s choice, and{" "}
        <strong>None</strong> blanks the group row&apos;s cell without touching
        the prop.
      </p>
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        onQueryChange={setQuery}
        query={query}
        rows={holdings}
        toolPanel={{ defaultActiveSection: "grouping" }}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
