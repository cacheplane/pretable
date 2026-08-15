import type { PretableColumn } from "@pretable/react";

import type { Order } from "./fetch-rows";

/**
 * Every `type` here must agree with what the endpoint believes the column is:
 * the filter menu offers operators by type, and an operator the server's column
 * type cannot use comes back as a 500 rather than as an unfiltered grid.
 *
 * The two `enum` columns declare their `options` rather than letting the
 * checklist auto-derive. Under external filtering the rows on hand are one
 * server-chosen window, so derived values would offer whichever of them
 * happened to load as if it were the complete universe.
 */
export const columns: PretableColumn<Order>[] = [
  { id: "customer", header: "Customer", widthPx: 150 },
  {
    id: "region",
    header: "Region",
    type: "enum",
    widthPx: 90,
    options: [
      { value: "North" },
      { value: "South" },
      { value: "East" },
      { value: "West" },
    ],
  },
  {
    id: "status",
    header: "Status",
    type: "enum",
    widthPx: 100,
    options: [
      { value: "open" },
      { value: "shipped" },
      { value: "delivered" },
      { value: "cancelled" },
    ],
  },
  { id: "total", header: "Total", type: "number", widthPx: 90 },
  { id: "placedAt", header: "Placed", type: "date", widthPx: 100 },
];
