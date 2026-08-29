import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A custom section",
  description:
    "toolPanel.sections states the complete rail: Columns, a consumer-authored Actions section, then Filters, with grouping left off. The custom pane's buttons reach the grid through the handle onGridReady delivers — scroll to a row, or export the grid as CSV.",
  files: ["CustomSectionGrid.tsx", "columns.ts", "data.ts"],
});
