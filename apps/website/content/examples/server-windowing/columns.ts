import type { PretableColumn } from "@pretable/react";

import type { Order } from "./fetch-rows";

/**
 * Every `type` here must agree with what the endpoint believes the column is:
 * the filter menu offers operators by type, and an operator the server's column
 * type cannot use comes back as a 500 rather than as an unfiltered grid.
 *
 * The two `enum` columns declare their `options` rather than letting the
 * checklist auto-derive. Under external filtering the rows on hand are one
 * server-chosen window — never more obviously than here — so derived values
 * would offer whichever hundred rows happened to be loaded as if they were the
 * complete universe for `isAnyOf`.
 *
 * Filtering and sorting are switched off, as they are on the totals page and
 * for a related reason: a filter or a sort redefines the population, and every
 * dataset position in it. That is a new `datasetKey`, a window reset to zero,
 * and a second story competing with this page's one. The section overview is
 * the grid that puts a query on the wire; this one holds the population still
 * so that the only thing moving is the window.
 */
export const columns: PretableColumn<Order>[] = [
  {
    id: "id",
    header: "Order",
    widthPx: 100,
    filterable: false,
    sortable: false,
  },
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
];
