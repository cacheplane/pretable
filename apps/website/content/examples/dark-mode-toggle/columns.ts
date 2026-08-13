import type { PretableColumn } from "@pretable/react";

import type { Task } from "./data";

export const columns: PretableColumn<Task>[] = [
  { id: "title", header: "Task", widthPx: 200 },
  { id: "owner", header: "Owner", widthPx: 110 },
  { id: "status", header: "Status", widthPx: 110 },
];
