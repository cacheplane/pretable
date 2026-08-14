import type { PretableColumn } from "@pretable/react";

import type { Order } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const columns: PretableColumn<Order>[] = [
  { id: "customer", header: "Customer" },
  { id: "region", header: "Region" },
  { id: "status", header: "Status" },
  {
    id: "total",
    header: "Total",
    type: "number",
    format: ({ value }) => usd.format(value as number),
  },
];
