import type { PretableColumn } from "@pretable/react";

import type { Order } from "./data";

export const columns: PretableColumn<Order>[] = [
  { id: "customer", header: "Customer", widthPx: 110 },
  { id: "total", header: "Total", type: "number", widthPx: 75 },
  // No `options` — the checklist loads its distinct values from the rows.
  { id: "status", header: "Status", type: "enum", widthPx: 95 },
  { id: "placedAt", header: "Placed", type: "date", widthPx: 100 },
  { id: "expedited", header: "Expedited", type: "boolean", widthPx: 115 },
];
