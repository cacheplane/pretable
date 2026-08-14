import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Custom aggregator: shares-weighted average price",
  description:
    "A mergeable init/accumulate/merge/finalize reducer computes a VWAP per group, shown beside the built-in avg preset on the same data so the two numbers visibly diverge.",
  files: ["WeightedAverageGrid.tsx", "columns.ts", "data.ts"],
});
