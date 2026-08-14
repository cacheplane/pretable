import type { PretableColumn } from "@pretable/react";

import type { Product } from "./data";

export const columns: PretableColumn<Product>[] = [
  { id: "sku", header: "SKU", widthPx: 110 },
  { id: "name", header: "Product", widthPx: 200 },
  { id: "category", header: "Category", widthPx: 130 },
  {
    id: "unitsInStock",
    header: "In stock",
    type: "number",
    widthPx: 100,
  },
];
