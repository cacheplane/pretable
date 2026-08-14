"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { orders } from "./data";

const VIEWPORT_HEIGHT = 340;

export function MultiColumnSortGrid() {
  // The complete query is controlled so the ordered sort list can be echoed
  // below the grid, in lockstep with the priority badges the headers render
  // themselves. Omit both query props to let rows mode own sorting instead.
  const [query, setQuery] = useState<
    NonNullable<
      ComponentProps<typeof PretableSurface<(typeof orders)[number]>>["query"]
    >
  >({
    filters: [],
    sort: [],
    rowGroups: [],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Click <strong>Status</strong> to sort by it. <kbd>Shift</kbd>+click{" "}
        <strong>Region</strong>, then <kbd>Shift</kbd>+click{" "}
        <strong>Total</strong> — each sorted header grows a priority badge. Now{" "}
        <kbd>Shift</kbd>+click <strong>Region</strong> twice more (desc → asc →
        removed) and watch <strong>Total</strong>&rsquo;s badge renumber from 3
        to 2.
      </p>
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={setQuery}
        query={query}
        rows={orders}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Sort:{" "}
        <code>
          {query.sort.length > 0
            ? query.sort
                .map(
                  (entry, index) =>
                    `${index + 1}. ${entry.columnId} ${entry.direction}`,
                )
                .join(" · ")
            : "(unsorted)"}
        </code>
      </p>
    </div>
  );
}
