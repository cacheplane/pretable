import type { PretableColumn } from "@pretable/react";

import type { Trade } from "./data";

export const columns: PretableColumn<Trade>[] = [
  { id: "symbol", header: "Symbol", widthPx: 110, type: "text" },
  { id: "side", header: "Side", widthPx: 90, type: "enum" },
  { id: "qty", header: "Qty", widthPx: 90, type: "number" },
  { id: "price", header: "Price", widthPx: 110, type: "number" },
];
