import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "The columns section",
  description:
    "The pane opens on load via defaultActiveSection. Hide, pin, and reorder columns and watch the drawn header follow each commit.",
  files: ["ToolPanelGrid.tsx", "columns.ts", "data.ts"],
});
