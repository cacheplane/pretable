import fs from "node:fs/promises";
import path from "node:path";

import { codeToHtml, type BundledLanguage, type BundledTheme } from "shiki";

import {
  langForFile,
  type ExampleLang,
  type ExampleMeta,
  type LoadedExample,
  type LoadedFile,
} from "./define";
import { stripFocusMarkers, type StripResult } from "./markers";
import { exampleRegistry, type ExampleId } from "./registry.generated";

/**
 * One theme, named once. The docs site is light-only today; when it gains dark
 * mode this is the single place that changes, rather than every example folder.
 */
const SHIKI_THEME: BundledTheme = "github-light";

const SHIKI_LANG: Readonly<Record<ExampleLang, BundledLanguage>> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  json: "json",
  bash: "bash",
};

// Mirrors the EXAMPLES constant in scripts/gen-example-registry.mjs by hand
// — that script can't import this module (no build step for .mjs -> .ts).
// Keep both in sync.
export const EXAMPLES_ROOT = "content/examples";

/**
 * `process.cwd()` is required here, not `import.meta.url` — in a built Next
 * output this module resolves inside `.next/server/`, while Next's file
 * tracing (and every place that invokes this repo's scripts and tests) is
 * cwd-relative to the app root. Getting this wrong fails silently: it still
 * resolves to *some* path, just the wrong one.
 */
export function exampleDir(id: string): string {
  return path.join(process.cwd(), EXAMPLES_ROOT, id);
}

/**
 * Reads, de-markers, and highlights an example's declared files.
 *
 * Focus lines are computed here from the source rather than by a Shiki plugin,
 * so the focus data is available to any consumer without re-parsing HTML; the
 * transformer below only paints what this function already decided.
 */
export async function loadExampleFiles(
  dir: string,
  meta: ExampleMeta,
): Promise<LoadedFile[]> {
  const out: LoadedFile[] = [];
  // Sequential by design: Promise.all would reject with whichever file loses
  // the race in *time*, not whichever is declared first, so a folder with two
  // bad files would report a different error nondeterministically across
  // runs — and the losing rejections would still fire as unhandled-rejection
  // warnings. Nothing below depends on files being loaded in parallel.
  for (const file of meta.files) {
    const full = path.join(dir, file);
    let raw: string;
    try {
      raw = await fs.readFile(full, "utf8");
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      const why =
        code === "ENOENT" ? "not found on disk" : `could not be read (${code})`;
      throw new Error(`Example file ${why}: ${full} (declared as "${file}")`, {
        cause,
      });
    }

    let stripped: StripResult;
    try {
      stripped = stripFocusMarkers(raw);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`In ${full}: ${message}`, { cause });
    }

    const source = stripped.source.trimEnd();
    // trimEnd() can drop trailing blank lines that a focus region covered;
    // filter those line numbers out so `focusLines` stays a true description
    // of `source`, and build the highlighter's lookup from the same filtered
    // set so the HTML and the returned data never disagree.
    const lineCount = source.split("\n").length;
    const focusLines = stripped.focusLines.filter((line) => line <= lineCount);
    const focus = new Set(focusLines);
    const lang = langForFile(file);
    const html = await codeToHtml(source, {
      lang: SHIKI_LANG[lang],
      theme: SHIKI_THEME,
      transformers: [
        {
          line(node, line) {
            if (focus.has(line)) this.addClassToHast(node, "line-focus");
          },
        },
      ],
    });

    out.push({
      path: file,
      lang,
      source,
      html,
      focusLines,
    });
  }
  return out;
}

const cache = new Map<string, Promise<LoadedExample>>();

/**
 * Registry-aware load, memoised per id. Pages are statically rendered, so each
 * file is read and highlighted once per build.
 */
export function loadExample(id: ExampleId): Promise<LoadedExample> {
  let hit = cache.get(id);
  if (!hit) {
    hit = loadOne(id);
    cache.set(id, hit);
  }
  return hit;
}

async function loadOne(id: ExampleId): Promise<LoadedExample> {
  const entry = exampleRegistry[id];
  if (!entry) throw new Error(`Unknown example id: "${id}"`);
  const files = await loadExampleFiles(exampleDir(id), entry.meta);
  return { id, meta: entry.meta, files, hasDemo: entry.hasDemo };
}
