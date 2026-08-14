import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Export CSV",
  description:
    "A products grid with a real Export CSV button wired to the grid handle's exportCsv, downloading an actual CSV file through defaultSaveFile.",
  files: ["ExportCsvGrid.tsx", "columns.ts", "data.ts"],
});
