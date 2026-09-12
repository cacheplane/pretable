import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Set an invoice due date",
  description:
    "Choose a calendar date or type YYYY-MM-DD, then inspect the canonical string or null.",
  files: ["DateEditingGrid.tsx"],
  height: 560,
});
