import type { PretableColumn } from "@pretable/react";

import type { Shipment } from "./data";

export const columns: PretableColumn<Shipment>[] = [
  { id: "lane", header: "Lane", widthPx: 130 },
  { id: "carrier", header: "Carrier", widthPx: 170 },
  { id: "status", header: "Status", widthPx: 110 },
];
