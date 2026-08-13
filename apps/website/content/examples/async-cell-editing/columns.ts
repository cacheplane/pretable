import type { PretableColumn } from "@pretable/react";

import type { StockItem } from "./data";

export const columns: PretableColumn<StockItem>[] = [
  { id: "item", header: "Item", editable: true, widthPx: 150 },
  {
    id: "quantity",
    header: "Quantity",
    type: "number",
    editable: true,
    widthPx: 90,
    // Built-in parsing already turned an empty draft into `null` and
    // rejected a non-numeric draft ("Not a number") by the time this runs —
    // this is for a domain rule, not parsing. The *negative* case is
    // deliberately left for onRowChange below, so it shows the async
    // `saving` → `error` phases instead of the synchronous `validating`
    // bounce this fractional check demonstrates.
    validate: (value) => {
      if (value === null) return true;
      if (typeof value === "number" && !Number.isInteger(value)) {
        return "Quantity must be a whole number";
      }
      return true;
    },
  },
  {
    id: "inStock",
    header: "In stock",
    type: "boolean",
    editable: true,
    widthPx: 80,
  },
  {
    id: "priority",
    header: "Priority",
    type: "enum",
    editable: true,
    widthPx: 100,
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  {
    id: "restockBy",
    header: "Restock by",
    type: "date",
    editable: true,
    widthPx: 110,
  },
];
