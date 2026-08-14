import type { PretableColumn } from "@pretable/react";

import type { Alert } from "./data";

export const columns: PretableColumn<Alert>[] = [
  { id: "rule", header: "Rule", widthPx: 220 },
  { id: "severity", header: "Severity", widthPx: 110 },
];
