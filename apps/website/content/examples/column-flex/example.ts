import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Fill the viewport with flex",
  description:
    "Two fixed columns, two flexible ones sharing the leftover width 2:1, and a floor on the narrower one.",
  files: ["ColumnFlexGrid.tsx", "columns.ts", "data.ts"],
});
