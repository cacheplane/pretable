import { numberFormats, type PretableColumn } from "@pretable/react";

import type { Product } from "./data";

export const columns = [
  { id: "name", header: "Product" },
  { id: "category", header: "Category" },
  {
    id: "price",
    header: "Price",
    type: "number",
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
] as const satisfies PretableColumn<Product>[];
