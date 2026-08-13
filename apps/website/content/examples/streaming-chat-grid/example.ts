import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Streaming chat grid",
  description:
    "Turn a streaming LLM response into rows with connectElementStream and append them to the grid as they arrive.",
  files: [
    "ChatGrid.tsx",
    "columns.ts",
    "response-events-to-chat-rows.ts",
    "scripted-response.ts",
  ],
});
