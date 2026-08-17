import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Reporting the query without controlling it",
  description:
    "Sort a header or apply a funnel and watch the request counter rise by exactly one: this grid keeps its own query and only reports that it changed, so onQueryChange arrives with no query prop beside it. Filter Customer for the word fail to watch a failed request leave every row it already had on screen, with the filter that failed still showing in the funnel above them.",
  files: ["NotifyOnlyGrid.tsx", "columns.ts", "fetch-rows.ts"],
  height: 460,
});
