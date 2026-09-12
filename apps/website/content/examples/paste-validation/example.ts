import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Paste and validate inventory quantities",
  description:
    "Apply valid quantities, keep rejected cells unchanged, and correct the values before trying again.",
  files: ["PasteValidationGrid.tsx", "columns.ts", "data.ts"],
  height: 760,
});
