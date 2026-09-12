import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Preview a CSV export",
  height: 650,
  description:
    "Choose columns, headers, and a delimiter, preview the grid's CSV output, then download the exact captured file.",
  files: ["ExportPreviewGrid.tsx", "columns.ts", "data.ts"],
});
