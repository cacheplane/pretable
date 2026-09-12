import { createColumnHelper } from "@pretable/core";

import type { Order } from "./data";

const column = createColumnHelper<Order>();

export const columns = [
  {
    ...column.accessor("id", { type: "text", header: "Order" }),
    widthPx: 90,
    filterable: false,
  },
  {
    ...column.accessor("customer", { type: "text", header: "Customer" }),
    widthPx: 100,
    filterable: false,
  },
  {
    ...column.accessor("status", { type: "text", header: "Status" }),
    widthPx: 90,
    filterable: false,
  },
] as const;
