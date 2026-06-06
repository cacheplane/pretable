import type { PretableColumn } from "@pretable/core";

import type { Service } from "./data";

export const columns: PretableColumn<Service>[] = [
  { id: "name", header: "Service", sortable: true },
  { id: "team", header: "Team", sortable: true, filterable: true },
  { id: "status", header: "Status", sortable: true },
  { id: "latencyMs", header: "Latency (ms)", sortable: true },
];
