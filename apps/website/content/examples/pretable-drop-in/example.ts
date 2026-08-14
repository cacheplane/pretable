import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A library catalog, three props of columns",
  description:
    "Five books rendered with createColumnHelper and the Pretable preset — no sort UI, no filter UI, no controlled state, just typed columns and rows.",
  files: ["demo.tsx", "columns.ts", "data.ts"],
});
