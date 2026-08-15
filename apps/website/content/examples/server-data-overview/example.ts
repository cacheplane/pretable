import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A grid whose filtering and sorting happen on the server",
  description:
    "Every header sort and column filter becomes one POST to /api/docs/rows with a 500ms delay, and the rows that come back were filtered and ordered there. The grid's job is to publish what the reader asked for and render the answer.",
  files: ["ServerDataGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
