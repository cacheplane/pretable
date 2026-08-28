import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "The grouping section",
  description:
    "The Grouping pane opens on load via defaultActiveSection. Add and reorder group-by levels, expand and collapse everything at once, flip hide-grouped-columns, and override a column's aggregate — with the drag-to-group strip reflecting every change.",
  files: ["GroupingSectionGrid.tsx", "columns.ts", "data.ts"],
});
