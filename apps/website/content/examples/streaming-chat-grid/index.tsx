import fs from "node:fs";
import path from "node:path";

import { codeToHtml } from "shiki";

import { defineExample } from "../../../lib/docs/define-example";
import type { ExampleLang } from "../../../lib/docs/define-example";

const DIR = path.join(process.cwd(), "content/examples/streaming-chat-grid");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

interface FileSpec {
  path: string;
  lang: ExampleLang;
}

const SPEC: readonly FileSpec[] = [
  { path: "ChatGrid.tsx", lang: "tsx" },
  { path: "columns.ts", lang: "ts" },
  { path: "response-events-to-chat-rows.ts", lang: "ts" },
];

const SHIKI_LANG: Record<ExampleLang, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  json: "json",
  bash: "bash",
};

// Pre-highlight every file at module load. Mirrors the existing CodeBlock
// pattern (top-level await on static input). No client JS needed.
const files = await Promise.all(
  SPEC.map(async (s) => {
    const source = read(s.path).trimEnd();
    const htmlSource = await codeToHtml(source, {
      lang: SHIKI_LANG[s.lang],
      theme: "github-light",
    });
    return { path: s.path, lang: s.lang, source, htmlSource };
  }),
);

// The live demo is deterministic; the source tabs show the typed adapter for
// a caller-provided Responses event stream.
import { MockChatGrid } from "./MockChatGrid";

export const streamingChatGrid = defineExample({
  title: "Streaming chat grid",
  Demo: <MockChatGrid />,
  files,
});
