import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Async cell editing",
  description:
    "One editor per column.type — text, number, boolean, enum, and date — committing through an 800ms onRowChange that rejects a negative quantity so you can watch the saving and error phases.",
  files: ["AsyncEditingGrid.tsx", "columns.ts", "data.ts"],
});
