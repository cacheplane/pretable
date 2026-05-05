import fs from "node:fs";
import path from "node:path";

import { defineExample } from "../../../lib/docs/define-example";

const DIR = path.join(process.cwd(), "content/examples/streaming-chat-grid");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

// Demo is a self-contained static placeholder so the source files (which import
// `openai`) don't need to be bundled. The source tabs still show the real code.
function Demo() {
  return (
    <div className="rounded-md border border-rule bg-bg-card/40 p-6 text-center">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-text-dim">
        Live demo placeholder
      </p>
      <p className="mt-2 font-display text-[14px] text-text-secondary">
        Wire your own streaming source — the source tabs show the full pattern.
      </p>
    </div>
  );
}

export const streamingChatGrid = defineExample({
  title: "Streaming chat grid",
  Demo: <Demo />,
  files: [
    { path: "page.tsx", lang: "tsx", source: read("page.tsx") },
    { path: "ChatGrid.tsx", lang: "tsx", source: read("ChatGrid.tsx") },
    { path: "columns.ts", lang: "ts", source: read("columns.ts") },
    {
      path: "openai-client.ts",
      lang: "ts",
      source: read("openai-client.ts"),
    },
  ],
});
