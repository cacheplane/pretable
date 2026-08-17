import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Watching a rebuild",
  description:
    "Filtering 150,000 rows cannot settle inside one animation frame, so status.kind cycles through rebuilding with a live completedRows/totalRows progress readout before returning to ready.",
  files: [
    "RebuildProgressDemo.tsx",
    "RebuildProgress.tsx",
    "columns.ts",
    "data.ts",
  ],
});
