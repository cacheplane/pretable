import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "CSV onCopy override",
  description:
    "Code-only: onCopy reuses serializeRanges for range/column/header handling, rewrites the TSV delimiter to a comma, and returns only text to opt out of the HTML flavor.",
  files: ["CsvClipboardGrid.tsx", "columns.ts", "data.ts"],
});
