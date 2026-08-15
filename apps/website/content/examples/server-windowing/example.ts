import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A hundred rows at a time, out of four hundred and eighty",
  description:
    "The grid holds one block of 100 orders and scrolls over all 480. When the viewport runs off the loaded window the grid says so through telemetry, the next block is fetched, and the block it replaces is dropped — so the dataset position climbs while the row count in memory does not.",
  files: ["WindowedGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
