import type { ReactNode } from "react";

export type ExampleLang =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "css"
  | "json"
  | "bash";

export interface ExampleFile {
  path: string;
  lang: ExampleLang;
  source: string;
  /** Optional Shiki-highlighted HTML; if present, Example renders it via dangerouslySetInnerHTML. */
  htmlSource?: string;
}

export interface ExampleDef {
  title: string;
  Demo: ReactNode;
  files: readonly ExampleFile[];
}

export function defineExample(def: ExampleDef): ExampleDef {
  return def;
}
