import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Multi-column sort cascade",
  description:
    "Click a header to sort by it, shift-click others to build an ordered cascade — each sorted header grows a priority badge, and shift-clicking a middle key back to unsorted renumbers the rest.",
  files: ["MultiColumnSortGrid.tsx", "columns.ts", "data.ts"],
});
