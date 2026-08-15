import { numberFormats, type PretableColumn } from "@pretable/react";

import type { Order } from "./search-orders";

/**
 * Every `type` agrees with what the endpoint believes the column is — its
 * `DOCS_COLUMN_TYPES` map — because a filter operator outside a column's type
 * comes back as a 500, not as an unfiltered grid.
 *
 * `filterable: false` throughout: the only query this example sends is the
 * search box above the grid, so a funnel here would publish a filter nothing
 * forwards. Wiring the funnels to the server is the `query` / `onQueryChange`
 * pair, which /docs/server-data/query-ownership covers.
 */
export const columns: PretableColumn<Order>[] = [
  { id: "id", header: "Order", filterable: false, widthPx: 100 },
  { id: "customer", header: "Customer", filterable: false, widthPx: 160 },
  { id: "region", header: "Region", type: "enum", filterable: false },
  { id: "status", header: "Status", type: "enum", filterable: false },
  {
    id: "total",
    header: "Total",
    type: "number",
    filterable: false,
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
  { id: "placedAt", header: "Placed", type: "date", filterable: false },
];
