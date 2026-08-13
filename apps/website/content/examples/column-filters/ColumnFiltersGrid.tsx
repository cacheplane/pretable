"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { type Order, orders } from "./data";

const VIEWPORT_HEIGHT = 320;

export function ColumnFiltersGrid() {
  // The query is controlled and seeded with an initial filter so the active
  // filters can be echoed below the grid. Omit both query props to let rows
  // mode own filtering uncontrolled instead — nothing here requires control.
  //
  // Typed via `ComponentProps`, not `PretableQueryFor<typeof columns>`: these
  // plain PretableColumn<Order>[] carry no `accessor` field, which
  // `PretableQueryFor` requires — applied directly it collapses every filter
  // to `never`. Pulling the type through the prop instead picks up
  // `<PretableSurface>`'s own fallback for accessor-less columns.
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<Order>>["query"]>
  >({
    filters: [{ columnId: "status", operator: "isAnyOf", value: ["open"] }],
    sort: [],
    rowGroups: [],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Hover a header for its funnel. <strong>Status</strong> declares no{" "}
        <code>options</code>, so its checklist loads distinct values from the
        rows. <strong>Total</strong>&rsquo;s <code>between</code> waits for both
        bounds before it filters anything.
      </p>
      <PretableSurface<Order>
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={setQuery}
        query={query}
        rows={orders}
        viewportHeight={VIEWPORT_HEIGHT}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        Active filters:{" "}
        <code>
          {query.filters.length > 0
            ? query.filters
                .map((filter) => `${filter.columnId} ${filter.operator}`)
                .join(" · ")
            : "(none)"}
        </code>
      </p>
    </div>
  );
}
