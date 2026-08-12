import { createColumnHelper } from "@pretable/core";

import type { Service } from "./data";

const column = createColumnHelper<Service>();

export const columns = [
  column.accessor("name", { type: "text", header: "Service" }),
  column.accessor("team", { type: "text", header: "Team" }),
  column.accessor("status", { type: "text", header: "Status" }),
  column.accessor("latencyMs", { type: "number", header: "Latency (ms)" }),
] as const;
