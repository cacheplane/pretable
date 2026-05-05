import { defineExample } from "../../../lib/docs/define-example";
import chatGridSource from "./ChatGrid.tsx?raw";
import { ChatGrid } from "./ChatGrid";
import columnsSource from "./columns.ts?raw";
import openaiSource from "./openai-client.ts?raw";
import pageSource from "./page.tsx?raw";

export const streamingChatGrid = defineExample({
  title: "Streaming chat grid",
  Demo: <ChatGrid prompt="Summarize the last 10 incidents" />,
  files: [
    { path: "page.tsx", lang: "tsx", source: pageSource },
    { path: "ChatGrid.tsx", lang: "tsx", source: chatGridSource },
    { path: "columns.ts", lang: "ts", source: columnsSource },
    { path: "openai-client.ts", lang: "ts", source: openaiSource },
  ],
});
