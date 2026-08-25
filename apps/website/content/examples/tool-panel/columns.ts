import type { PretableColumn } from "@pretable/react";

import type { Holding } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-US");

// Symbol starts pinned left so the panel's Pinned left subgroup renders from
// the first paint — dragging a row across that subgroup boundary (or pressing
// Shift+Arrow past it) re-pins the column.
export const columns: PretableColumn<Holding>[] = [
  { id: "symbol", header: "Symbol", pinned: "left", widthPx: 90 },
  { id: "desk", header: "Desk", widthPx: 110 },
  { id: "sector", header: "Sector", widthPx: 120 },
  {
    id: "quantity",
    header: "Qty",
    type: "number",
    widthPx: 90,
    format: ({ value }) => count.format(value as number),
  },
  {
    id: "price",
    header: "Price",
    type: "number",
    widthPx: 90,
    format: ({ value }) => usd.format(value as number),
  },
  {
    id: "marketValue",
    header: "Market value",
    type: "number",
    widthPx: 120,
    format: ({ value }) => usd.format(value as number),
  },
];
