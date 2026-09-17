import type { PretableColumn } from "@pretable/react";

import type { Ticket } from "./data";

/**
 * Two fixed columns and two flexible ones. The leftover viewport width is
 * split 2:1 between Summary and Owner; Owner also carries a floor so it never
 * collapses to a sliver when the viewport is narrow.
 */
export const columns: PretableColumn<Ticket>[] = [
  { id: "key", header: "Key", widthPx: 88 },
  { id: "status", header: "Status", widthPx: 104 },
  // [!focus:start]
  { id: "summary", header: "Summary", flex: 2 },
  { id: "owner", header: "Owner", flex: 1, minWidthPx: 110 },
  // [!focus:end]
];
