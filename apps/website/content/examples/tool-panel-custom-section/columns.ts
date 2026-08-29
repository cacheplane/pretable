import type { PretableColumn } from "@pretable/react";

import type { Trade } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const columns: PretableColumn<Trade>[] = [
  { id: "symbol", header: "Symbol", widthPx: 90 },
  { id: "side", header: "Side", type: "enum", widthPx: 80 },
  { id: "desk", header: "Desk", type: "enum", widthPx: 100 },
  { id: "quantity", header: "Qty", type: "number", widthPx: 90 },
  {
    id: "price",
    header: "Price",
    type: "number",
    widthPx: 100,
    format: ({ value }) => usd.format(value as number),
  },
];
