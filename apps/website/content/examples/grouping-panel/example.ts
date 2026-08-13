import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Drag-to-group panel",
  description:
    "The query is controlled here, so dragging a header onto the panel updates both the grid and the level list shown below it.",
  files: ["GroupingPanelGrid.tsx", "columns.ts", "data.ts"],
});
