import type { PretableColumn } from "@pretable/react";

import type { LogLine } from "./data";

export const columns: PretableColumn<LogLine>[] = [
  { id: "time", header: "Time", widthPx: 90 },
  { id: "service", header: "Service", widthPx: 90 },
  { id: "message", header: "Message", widthPx: 220 },
];
