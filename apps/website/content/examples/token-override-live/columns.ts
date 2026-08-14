import type { PretableColumn } from "@pretable/react";

import type { Product } from "./data";

export const columns: PretableColumn<Product>[] = [
  { id: "name", header: "Product", widthPx: 160 },
  { id: "category", header: "Category", widthPx: 130 },
  { id: "price", header: "Price ($)", widthPx: 90, type: "number" },
];
