import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Resize, reorder, and pin",
  description:
    "Column width, order, and pin are controlled here, so the layout gestures below the grid stay visible after each drag.",
  files: ["ColumnLayoutGrid.tsx", "columns.ts", "data.ts"],
});
