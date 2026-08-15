import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Reporting the query without controlling it",
  description:
    "Sort a header or apply a funnel and watch the request counter rise by exactly one: this grid keeps its own query and only reports that it changed, so onQueryChange arrives with no query prop beside it. Filter Customer for the word fail to watch a failed request leave its rows on screen while the query that failed goes on filtering them.",
  files: ["NotifyOnlyGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
