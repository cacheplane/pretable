import type { PretableColumn } from "@pretable/react";

import type { Metric } from "./data";

export const columns: PretableColumn<Metric>[] = [
  { id: "name", header: "Metric", widthPx: 150 },
  { id: "value", header: "Value", widthPx: 90 },
];
