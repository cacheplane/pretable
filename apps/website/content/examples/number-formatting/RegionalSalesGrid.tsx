"use client";

import { useState, type ComponentProps } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { orders, type Order } from "./data";

const VIEWPORT_HEIGHT = 340;

export function RegionalSalesGrid() {
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<Order>>["query"]>
  >({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "region" }],
  });

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Revenue uses <code>numberFormats.money</code>, Refunds uses{" "}
        <code>numberFormats.accounting</code> (negative values print
        parenthesized), and Margin is a raw percent <code>numberFormat</code>.
        Grouped by region — every aggregate row below inherits its own
        column&apos;s format with no <code>formatAggregate</code> callback.
      </p>
      <PretableSurface<Order>
        ariaLabel="Regional sales"
        columns={columns}
        getRowId={(row) => row.id}
        groupColumn={{ header: "Region", widthPx: 200 }}
        locale="en-US"
        onQueryChange={setQuery}
        query={query}
        rows={orders}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}
