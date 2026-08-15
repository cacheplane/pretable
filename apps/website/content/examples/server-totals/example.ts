import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "One result set, three claims about how many rows it has",
  description:
    "The radio buttons change nothing about the records — the same 480 orders come back every time — only how sure the server says it is of the count. Watch what that alone changes: what an export may call all rows, and what the grid is willing to announce as aria-rowcount.",
  files: ["TotalsGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
