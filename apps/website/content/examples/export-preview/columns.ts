import { numberFormats, type PretableColumn } from "@pretable/react";

import type { Order } from "./data";

export const columns: readonly PretableColumn<Order>[] = [
  {
    id: "id",
    header: "Order",
    widthPx: 90,
    filterable: false,
    sortable: false,
  },
  {
    id: "customer",
    header: "Customer",
    widthPx: 110,
    filterable: false,
    sortable: false,
  },
  {
    id: "total",
    header: "Total",
    type: "number",
    numberFormat: numberFormats.money({ currency: "USD" }),
    widthPx: 90,
    filterable: false,
    sortable: false,
  },
];
