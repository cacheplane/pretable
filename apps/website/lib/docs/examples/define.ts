/** Languages an example file may be highlighted as. */
export type ExampleLang = "ts" | "tsx" | "js" | "jsx" | "css" | "json" | "bash";

/** Pane height, in px, used when an example does not specify one. */
export const DEFAULT_EXAMPLE_HEIGHT = 480;

export interface ExampleMeta {
  title: string;
  description: string;
  /**
   * Filenames inside the example folder, in tab order. `files[0]` is the tab
   * the Code view opens on. Every file here must exist on disk, and every
   * non-conventional file in the folder must appear here — both directions are
   * enforced by the registry guard test.
   */
  readonly files: readonly string[];
  /** Shared height of the Preview and Code panes, in px. */
  height?: number;
}

export interface LoadedFile {
  path: string;
  lang: ExampleLang;
  /** Source with focus markers stripped. What readers see and copy. */
  source: string;
  /** Shiki output for `source`, with focused lines carrying `.line-focus`. */
  html: string;
  /** 1-based line numbers, relative to `source`. Empty when nothing is marked. */
  readonly focusLines: readonly number[];
}

export interface LoadedExample {
  id: string;
  meta: ExampleMeta;
  readonly files: readonly LoadedFile[];
  hasDemo: boolean;
}

/** Identity function that pins the meta type at the authoring site. */
export function defineExample(meta: ExampleMeta): ExampleMeta {
  return meta;
}

const LANG_BY_EXT: Readonly<Record<string, ExampleLang>> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  css: "css",
  json: "json",
  sh: "bash",
};

/** Infers the highlight language from a filename's extension. */
export function langForFile(file: string): ExampleLang {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const lang = LANG_BY_EXT[ext];
  if (!lang) {
    throw new Error(
      `Example file "${file}" has no known highlight language. Supported extensions: ${Object.keys(LANG_BY_EXT).join(", ")}.`,
    );
  }
  return lang;
}
