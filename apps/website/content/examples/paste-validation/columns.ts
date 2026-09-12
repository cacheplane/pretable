import type { PretableColumn } from "@pretable/react";

import type { InventoryItem } from "./data";

export const columns: PretableColumn<InventoryItem>[] = [
  {
    id: "product",
    header: "Product",
    type: "text",
    editable: false,
    sortable: false,
    filterable: false,
    widthPx: 150,
  },
  {
    id: "quantity",
    header: "Quantity",
    type: "number",
    editable: true,
    sortable: false,
    filterable: false,
    widthPx: 110,
    validate: (value) => {
      // Built-in number parsing rejects "abc" before this rule runs.
      if (value === null) return "Quantity is required";
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return "Quantity must be a whole number";
      }
      if (value < 0) return "Quantity must be zero or greater";
      return true;
    },
  },
];
