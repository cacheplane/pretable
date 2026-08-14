import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Distinct-value search",
  description:
    "A team search box calls rowModel.distinctValues on every keystroke, cancelling the previous request so a slow early result can never overwrite a faster later one.",
  files: ["DistinctValuesDemo.tsx", "columns.ts", "data.ts"],
});
