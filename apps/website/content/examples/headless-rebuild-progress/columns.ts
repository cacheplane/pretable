import { createColumnHelper } from "@pretable/core";

import type { Order } from "./data";

const column = createColumnHelper<Order>();

export const columns = [
  column.accessor("customer", { type: "text", header: "Customer" }),
  column.accessor("region", { type: "text", header: "Region" }),
  column.accessor("amount", { type: "number", header: "Amount" }),
] as const;
