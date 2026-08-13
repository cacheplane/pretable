import type { PretableColumn } from "@pretable/react";

import type { Trade } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// ID pinned left, Status pinned right — the two sticky column groups the
// "clear of pinned chrome" rule has to reveal focus past. The middle columns
// are wide enough that the grid needs to scroll horizontally too, not just
// vertically, so Home/End inside a row exercise the same reveal math.
export const columns: PretableColumn<Trade>[] = [
  { id: "id", header: "ID", pinned: "left", widthPx: 80 },
  { id: "time", header: "Time", widthPx: 110 },
  { id: "account", header: "Account", widthPx: 120 },
  { id: "symbol", header: "Symbol", widthPx: 90 },
  { id: "side", header: "Side", widthPx: 80 },
  { id: "quantity", header: "Qty", type: "number", widthPx: 90 },
  {
    id: "price",
    header: "Price",
    type: "number",
    widthPx: 100,
    format: ({ value }) => usd.format(value as number),
  },
  { id: "status", header: "Status", pinned: "right", widthPx: 110 },
];
