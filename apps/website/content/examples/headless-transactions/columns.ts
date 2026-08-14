import { createColumnHelper } from "@pretable/core";

import type { Task } from "./data";

const column = createColumnHelper<Task>();

export const columns = [
  column.accessor("title", { type: "text", header: "Task" }),
  column.accessor("status", { type: "text", header: "Status" }),
] as const;
