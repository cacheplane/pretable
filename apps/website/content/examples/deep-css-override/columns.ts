import type { PretableColumn } from "@pretable/react";

import type { Ticket } from "./data";

export const columns: PretableColumn<Ticket>[] = [
  { id: "subject", header: "Subject", widthPx: 220 },
  { id: "assignee", header: "Assignee", widthPx: 110 },
  { id: "priority", header: "Priority", widthPx: 100 },
];
