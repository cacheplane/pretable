import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Streaming chat grid",
  description:
    "Adapt a Responses-style event stream into rows and feed them to the grid as they arrive.",
  files: ["ChatGrid.tsx", "columns.ts", "response-events-to-chat-rows.ts"],
});
