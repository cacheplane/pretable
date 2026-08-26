import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "The filters section",
  description:
    "The Filters pane opens on load via defaultActiveSection. Add a condition, nest a group, flip a list between and and or, and watch the row count follow — then open a header funnel onto the same tree.",
  files: ["FilterBuilderGrid.tsx", "columns.ts", "data.ts"],
});
