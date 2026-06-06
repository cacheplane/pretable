import fs from "node:fs";
import path from "node:path";

import { codeToHtml } from "shiki";

import { defineExample } from "../../../lib/docs/define-example";
import type { ExampleLang } from "../../../lib/docs/define-example";

const DIR = path.join(
  process.cwd(),
  "content/examples/headless-custom-renderer",
);
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

interface FileSpec {
  path: string;
  lang: ExampleLang;
}

const SPEC: readonly FileSpec[] = [
  { path: "page.tsx", lang: "tsx" },
  { path: "columns.ts", lang: "ts" },
  { path: "data.ts", lang: "ts" },
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

import { HeadlessTable } from "./HeadlessTable";

export const headlessCustomRenderer = defineExample({
  title: "Headless custom renderer",
  Demo: <HeadlessTable />,
  files,
});
