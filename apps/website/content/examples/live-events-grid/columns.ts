import { createColumnHelper } from "@pretable/core";

import type { EventRow } from "./data";

const column = createColumnHelper<EventRow>();

export const columns = [
  column.accessor("timestamp", { type: "date", header: "Time" }),
  column.accessor("message", { type: "text", header: "Message" }),
] as const;
