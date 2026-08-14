import type { PretableColumn } from "@pretable/react";

import type { Order } from "./data";

export const columns: PretableColumn<Order>[] = [
  { id: "id", header: "Order" },
  { id: "sku", header: "SKU" },
  { id: "qty", header: "Qty", type: "number" },
  { id: "total", header: "Total", type: "number" },
];
