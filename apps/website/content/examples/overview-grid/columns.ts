import { numberFormats, type PretableColumn } from "@pretable/react";

import type { Customer } from "./data";

export const columns: PretableColumn<Customer>[] = [
  { id: "name", header: "Account" },
  { id: "plan", header: "Plan" },
  {
    id: "mrr",
    header: "MRR",
    type: "number",
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
];
