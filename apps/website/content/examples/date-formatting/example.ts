import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Invoice due dates",
  description:
    "Switch locales and sort canonical invoice dates while comparing their formatted display with unchanged stored values.",
  files: ["InvoiceDatesGrid.tsx", "columns.ts", "data.ts"],
  height: 480,
});
