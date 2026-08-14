import type { PretableColumn } from "@pretable/react";

import type { Ticket } from "./data";

export const columns: PretableColumn<Ticket>[] = [
  { id: "subject", header: "Subject", widthPx: 220 },
  { id: "priority", header: "Priority", widthPx: 110 },
  { id: "status", header: "Status", widthPx: 130 },
];
