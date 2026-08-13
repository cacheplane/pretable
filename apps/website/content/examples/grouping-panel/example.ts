import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Drag-to-group panel",
  description:
    "Enable the grouping panel and drag column headers in to build levels. The query is controlled so the current levels can be shown outside the grid.",
  files: ["GroupingPanelGrid.tsx", "columns.ts", "data.ts"],
});
