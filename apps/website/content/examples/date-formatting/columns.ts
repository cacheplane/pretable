import { createColumnHelper } from "@pretable/core";

import type { Invoice } from "./data";

const column = createColumnHelper<Invoice>();

export const columns = [
  column.accessor("id", { type: "text", header: "Invoice", widthPx: 100 }),
  column.accessor("due", {
    header: "Due date",
    type: "date",
    dateFormat: { dateStyle: "medium" },
    widthPx: 150,
  }),
  column.accessor("rawDue", (row) => row.due, {
    type: "text",
    header: "Stored value",
    format: ({ value }) => (value === null ? "null" : String(value)),
    widthPx: 130,
  }),
] as const;
