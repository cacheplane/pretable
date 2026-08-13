import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Partial row stream",
  description:
    "Grow one row's content cell in place with connectPartialStream, covering both the seeded-row and createRow/onIssue patterns.",
  files: ["PartialRowGrid.tsx", "columns.ts", "scripted-partials.ts"],
});
