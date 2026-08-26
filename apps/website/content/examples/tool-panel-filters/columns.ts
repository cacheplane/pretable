import type { PretableColumn } from "@pretable/react";

import type { Holding } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-US");

// `desk` and `sector` are declared `enum` without `options`, so both the
// header funnel and the panel's row get a checklist derived from the rows
// themselves — the same distinct-value request, from the same row model.
export const columns: PretableColumn<Holding>[] = [
  { id: "symbol", header: "Symbol", widthPx: 90 },
  { id: "desk", header: "Desk", type: "enum", widthPx: 110 },
  { id: "sector", header: "Sector", type: "enum", widthPx: 120 },
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
