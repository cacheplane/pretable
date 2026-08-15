import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "An explicit dataState lifecycle over a real endpoint",
  description:
    'A customer search against /api/docs/rows, with its real 500ms delay, so loading, stale, idle and error are the actual phases rather than a description of them — search for "fail" to reach the error phase, and the rows already on screen stay sortable through it.',
  files: ["DataStateGrid.tsx", "columns.ts", "search-orders.ts"],
  height: 420,
});
