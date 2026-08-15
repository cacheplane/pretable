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
 * happened to load as if it were the complete universe for `isAnyOf`.
 *
 * Filtering and sorting are switched off in this grid, and only in this one.
 * Its query never leaves the client — the radio buttons change the TOTAL, not
 * the request's query — so a funnel here would filter locally while
 * `processing` claims the server chose the records, and an exact total would
 * go on announcing 481 rows over a body showing thirty. That is precisely the
 * dishonesty this page is about, so the example does not offer it. A real
 * server-filtered grid puts the query on the wire and leaves both on — that is
 * the grid on the section overview.
 */
export const columns: PretableColumn<Order>[] = [
  {
    id: "customer",
    header: "Customer",
    widthPx: 150,
    filterable: false,
    sortable: false,
  },
  {
    id: "region",
    header: "Region",
    type: "enum",
    widthPx: 90,
    filterable: false,
    sortable: false,
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
    filterable: false,
    sortable: false,
    options: [
      { value: "open" },
      { value: "shipped" },
      { value: "delivered" },
      { value: "cancelled" },
    ],
  },
  {
    id: "total",
    header: "Total",
    type: "number",
    widthPx: 90,
    filterable: false,
    sortable: false,
  },
  {
    id: "placedAt",
    header: "Placed",
    type: "date",
    widthPx: 100,
    filterable: false,
    sortable: false,
  },
];
