import type { PretableColumn } from "@pretable/react";

import type { Position } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Symbol and Qty are adjacent and both editable so the 2x2 clipboard block
// below always lands on a clean pair of columns. Price is read-only — it
// never appears in the pasted block, so it stays out of the geometry story.
export const columns: PretableColumn<Position>[] = [
  { id: "symbol", header: "Symbol", editable: true, widthPx: 90 },
  { id: "qty", header: "Qty", type: "number", editable: true, widthPx: 80 },
  {
    id: "price",
    header: "Price",
    type: "number",
    widthPx: 90,
    format: ({ value }) => usd.format(value as number),
  },
];
