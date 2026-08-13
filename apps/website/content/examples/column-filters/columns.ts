import type { PretableColumn } from "@pretable/react";

import type { Order } from "./data";

export const columns: PretableColumn<Order>[] = [
  { id: "customer", header: "Customer", widthPx: 130 },
  { id: "total", header: "Total", type: "number", widthPx: 90 },
  // No `options` — the checklist loads its distinct values from the rows.
  { id: "status", header: "Status", type: "enum", widthPx: 110 },
  { id: "placedAt", header: "Placed", type: "date", widthPx: 120 },
];
