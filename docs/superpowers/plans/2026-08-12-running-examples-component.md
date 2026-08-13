# Running Examples Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the docs site's per-example wrapper components and duplicated Shiki boilerplate with one `<Example id="…" />` component driven by a generated registry, and make the same example source reachable by agents through four markdown surfaces.

**Architecture:** An example is a folder under `apps/website/content/examples/<slug>/` containing `example.ts` (pure metadata), an optional `demo.tsx`, and the real source files. A codegen script emits two registry modules — metadata-only and demo-components — so server-only markdown routes never import client components. A shared loader reads files from disk, strips in-source focus markers, and highlights with Shiki. A single `toMarkdown` serializer feeds the raw-docs route, a per-example route, the copy-for-agent button, and `llms.txt`.

**Tech Stack:** Next.js 16 (App Router, RSC), next-mdx-remote/rsc, Shiki 4, React 19, Vitest + @testing-library/react, Playwright, Tailwind + `app/globals.css`.

**Design spec:** `docs/superpowers/specs/2026-08-12-running-examples-component-design.md`

**Working directory:** all paths below are relative to the repo root. The website package is `apps/website`; run its commands with `pnpm --filter @pretable/app-website <script>` or from inside `apps/website`.

---

## File Structure

**Created — library (`apps/website/lib/docs/examples/`):**

| File | Responsibility |
| --- | --- |
| `define.ts` | Types (`ExampleMeta`, `LoadedFile`, `LoadedExample`), `defineExample`, `DEFAULT_EXAMPLE_HEIGHT`, `langForFile`. No I/O. |
| `markers.ts` | Focus-marker parsing: strip markers, return clean source + 1-based focus lines. Pure string function. |
| `load.ts` | Reads an example's files from disk, applies `markers`, highlights with Shiki, memoises per id. |
| `serialize.ts` | `toMarkdown(example, opts)` — the one markdown representation of an example. `exampleCatalogLine(id, meta)` — the one `llms.txt` catalog-entry format. |
| `expand.ts` | `expandExamples(raw, load?)` — substitutes `<Example id="…" />` tags in an MDX source string. |
| `urls.ts` | `examplePath(id)` and `exampleCanonicalUrl(id)`. One place that knows the URL shape. |
| `registry.generated.ts` | Generated. Slug → `{ meta, hasDemo }`. Metadata only; safe for server routes. |
| `demos.generated.ts` | Generated. Slug → demo component. Imported only by `<Example>`. |

**Created — components (`apps/website/app/components/docs/mdx/`):**

| File | Responsibility |
| --- | --- |
| `Example.tsx` | Server component. Loads, serializes, picks the demo, renders the shell. |
| `ExampleShell.tsx` | Client component. Preview/Code toggle, file tabs, copy actions, a11y. |

**Created — routes and scripts:**

- `apps/website/app/examples-md/[slug]/route.ts` — per-example markdown.
- `apps/website/scripts/gen-example-registry.mjs` — codegen with `--check`.

**Modified:**

- `apps/website/app/components/docs/MdxRenderer.tsx` — register `Example` only.
- `apps/website/app/components/CodeExample.tsx` — homepage reads through the registry.
- `apps/website/lib/docs/raw-response.ts` — expand examples.
- `apps/website/app/llms-full.txt/build.ts` — expand examples.
- `apps/website/app/llms.txt/build.ts` — add an `## Examples` section.
- `apps/website/proxy.ts` — rewrite `/examples/<slug>.md` → `/examples-md/<slug>`.
- `apps/website/app/globals.css` — pane and focus-dim styles.
- `apps/website/package.json` — `examples:gen`, `examples:check`, pre-script wiring.
- `.github/workflows/ci.yml` — registry freshness job.
- `apps/website/content/docs/grid/grouping.mdx`, `apps/website/content/docs/headless/getting-started.mdx`.

**Deleted:**

- `apps/website/lib/docs/define-example.ts`
- `apps/website/app/components/docs/mdx/Example.tsx` (old client version, replaced)
- `apps/website/app/components/docs/mdx/GroupingExample.tsx`
- `apps/website/app/components/docs/mdx/HeadlessExample.tsx`
- `apps/website/content/examples/*/index.tsx` (all three)

**Parallelisable:** Tasks 1–5 are independent of each other except that 3 and 4 import types from 1. Tasks 8, 9, 10 are independent of each other once 4 and 6 land. Tasks 11 and 12 come last.

---

### Task 1: Types and `defineExample`

**Files:**
- Create: `apps/website/lib/docs/examples/define.ts`
- Test: `apps/website/lib/docs/__tests__/examples-define.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/examples-define.test.ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXAMPLE_HEIGHT,
  defineExample,
  langForFile,
} from "../examples/define";

describe("defineExample", () => {
  it("returns the meta unchanged", () => {
    const meta = defineExample({
      title: "T",
      description: "D",
      files: ["a.ts"],
    });
    expect(meta).toEqual({ title: "T", description: "D", files: ["a.ts"] });
  });
});

describe("langForFile", () => {
  it("maps known extensions", () => {
    expect(langForFile("a.tsx")).toBe("tsx");
    expect(langForFile("a.ts")).toBe("ts");
    expect(langForFile("a.jsx")).toBe("jsx");
    expect(langForFile("a.js")).toBe("js");
    expect(langForFile("a.css")).toBe("css");
    expect(langForFile("a.json")).toBe("json");
    expect(langForFile("a.sh")).toBe("bash");
  });

  it("throws on an extension it cannot highlight", () => {
    expect(() => langForFile("logo.svg")).toThrow(/logo\.svg/);
  });
});

describe("DEFAULT_EXAMPLE_HEIGHT", () => {
  it("is 480", () => {
    expect(DEFAULT_EXAMPLE_HEIGHT).toBe(480);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `apps/website`: `pnpm exec vitest run lib/docs/__tests__/examples-define.test.ts`
Expected: FAIL — cannot resolve `../examples/define`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/website/lib/docs/examples/define.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-define.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/docs/examples/define.ts apps/website/lib/docs/__tests__/examples-define.test.ts
git commit -m "feat(docs): example metadata types and language inference"
```

---

### Task 2: Focus-marker parsing

Focus is declared in the source file so it survives edits. This task is the parser: it removes the markers and reports which lines were marked.

**Files:**
- Create: `apps/website/lib/docs/examples/markers.ts`
- Test: `apps/website/lib/docs/__tests__/examples-markers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/examples-markers.test.ts
import { describe, expect, it } from "vitest";

import { stripFocusMarkers } from "../examples/markers";

describe("stripFocusMarkers", () => {
  it("leaves unmarked source byte-identical and reports no focus", () => {
    const src = "const a = 1;\nconst b = 2;";
    expect(stripFocusMarkers(src)).toEqual({ source: src, focusLines: [] });
  });

  it("removes a trailing marker and focuses that line", () => {
    const result = stripFocusMarkers(
      ["const a = 1;", "const b = 2; // [!focus]", "const c = 3;"].join("\n"),
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;\nconst c = 3;");
    expect(result.focusLines).toEqual([2]);
  });

  it("removes a region's marker lines and focuses the lines between", () => {
    const result = stripFocusMarkers(
      [
        "const a = 1;",
        "// [!focus:start]",
        "const b = 2;",
        "const c = 3;",
        "// [!focus:end]",
        "const d = 4;",
      ].join("\n"),
    );
    expect(result.source).toBe(
      "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;",
    );
    expect(result.focusLines).toEqual([2, 3]);
  });

  it("accepts block-comment markers for languages without //", () => {
    const result = stripFocusMarkers(
      [".a { color: red; } /* [!focus] */", ".b { color: blue; }"].join("\n"),
    );
    expect(result.source).toBe(".a { color: red; }\n.b { color: blue; }");
    expect(result.focusLines).toEqual([1]);
  });

  it("throws on a start with no end", () => {
    expect(() =>
      stripFocusMarkers("// [!focus:start]\nconst a = 1;"),
    ).toThrow(/\[!focus:start\] without a matching \[!focus:end\]/);
  });

  it("throws on an end with no start", () => {
    expect(() => stripFocusMarkers("const a = 1;\n// [!focus:end]")).toThrow(
      /\[!focus:end\] without a matching \[!focus:start\]/,
    );
  });

  it("throws on a nested start", () => {
    expect(() =>
      stripFocusMarkers(
        ["// [!focus:start]", "// [!focus:start]", "// [!focus:end]"].join("\n"),
      ),
    ).toThrow(/\[!focus:start\] inside an open region/);
  });

  it("includes the line number in start/end/nested errors", () => {
    expect(() => stripFocusMarkers("// [!focus:start]\nconst a = 1;")).toThrow(
      /\(line 1\)/,
    );
    expect(() => stripFocusMarkers("const a = 1;\n// [!focus:end]")).toThrow(
      /\(line 2\)/,
    );
    expect(() =>
      stripFocusMarkers(
        ["// [!focus:start]", "// [!focus:start]", "// [!focus:end]"].join(
          "\n",
        ),
      ),
    ).toThrow(/\(line 2\)/);
  });

  it("throws when a trailing marker has content after it", () => {
    expect(() =>
      stripFocusMarkers("const a = 1; // [!focus] explain why"),
    ).toThrow(/unrecognized "\[!focus\.\.\.\]" on line 1/);
  });

  it("throws on a mid-line block-comment marker", () => {
    expect(() => stripFocusMarkers("/* [!focus] */ const a = 1;")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
  });

  it("throws when a repeated marker leaves a residual behind", () => {
    expect(() =>
      stripFocusMarkers("const a = 1; // [!focus] // [!focus]"),
    ).toThrow(/unrecognized "\[!focus\.\.\.\]" on line 1/);
  });

  it("rejects a mismatched line/block-comment pair", () => {
    expect(() => stripFocusMarkers("// [!focus] */")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
    expect(() => stripFocusMarkers(".a { color: red; } /* [!focus]")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
  });

  it("drops a line that strips to nothing, without focusing a blank line", () => {
    const result = stripFocusMarkers(
      ["const a = 1;", "// [!focus]", "const b = 2;"].join("\n"),
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;");
    expect(result.focusLines).toEqual([]);
  });

  it("normalizes CRLF input to consistent LF line endings", () => {
    const result = stripFocusMarkers(
      "const a = 1;\r\nconst b = 2; // [!focus]\r\nconst c = 3;",
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;\nconst c = 3;");
    expect(result.source).not.toMatch(/\r/);
    expect(result.focusLines).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-markers.test.ts`
Expected: FAIL — cannot resolve `../examples/markers`.

- [ ] **Step 3: Write the implementation**

A first pass at this parser (matching each marker form independently, with an unpaired `(?:\*\/)?` on the closing side, and no check for leftover marker-shaped text) shipped and was caught in review: `// [!focus] extra text`, `/* [!focus] */` in the middle of a line, `// [!focus] // [!focus]` (only the last copy stripped), and mismatched pairs like `// [!focus] */` or an unterminated `/* [!focus]` all passed through silently instead of failing loudly — and a silent pass-through on an unterminated block comment can comment out the rest of a live CSS example. The version below pairs each comment style with its own closer and, after every line is otherwise handled, scans what's left for anything still shaped like `[!focus…]` and throws, naming the line. It also normalizes CRLF input, drops a marker-only line instead of leaving a focused blank behind, and reports a line number on every thrown error.

```ts
// apps/website/lib/docs/examples/markers.ts

/**
 * Focus is declared inside the example source, not in metadata, so it travels
 * with the code through any edit. Markers are inert comments — the file still
 * compiles and runs as part of the live demo — and are removed here before the
 * source is displayed, copied, or serialized for an agent.
 *
 *   const x = 1;            // [!focus]
 *   // [!focus:start] ... // [!focus:end]
 */

const START =
  /^\s*(?:\/\/\s*\[!focus:start\]|\/\*\s*\[!focus:start\]\s*\*\/)\s*$/;
const END = /^\s*(?:\/\/\s*\[!focus:end\]|\/\*\s*\[!focus:end\]\s*\*\/)\s*$/;
const INLINE = /\s*(?:\/\/\s*\[!focus\]|\/\*\s*\[!focus\]\s*\*\/)\s*$/;

/**
 * Anything shaped like a focus marker that survived the checks above — a
 * marker with trailing content after it, a mismatched comment pair, or a
 * second marker left behind when only the last one on a line was stripped.
 * Matches `[!focus]`, `[!focus:start]`, `[!focus:end]`, etc.
 */
const RESIDUAL_MARKER = /\[!focus[\]:]/;

export interface StripResult {
  readonly source: string;
  /** 1-based line numbers in `source`. */
  readonly focusLines: readonly number[];
}

/**
 * Strips `[!focus]` markers from `input` and reports which lines they mark.
 *
 * Recognized forms:
 * - a trailing marker that ends its line, e.g. `code; // [!focus]` (or the
 *   block-comment equivalent, for languages without `//`)
 * - a region, `// [!focus:start]` … `// [!focus:end]` (or the block-comment
 *   equivalent) — every line between the two is focused, and the marker
 *   lines themselves are dropped from the output.
 *
 * A line that strips to nothing (a marker alone on its own line) is dropped
 * entirely, the same way a region's marker lines are — it would otherwise
 * leave a focused blank line behind. Input line endings are read as
 * `\r?\n`; the result always joins with `\n`.
 *
 * @returns `source` with markers removed, and `focusLines` — 1-based line
 *   numbers in `source` — for every focused line.
 * @throws {Error} If a `[!focus…]`-shaped marker doesn't match one of the
 *   recognized forms above (trailing content after it, or a mismatched
 *   comment pair), if `[!focus:end]` appears with no open region, if
 *   `[!focus:start]` appears while a region is already open, or if a region
 *   is left unclosed at the end of the input.
 */
export function stripFocusMarkers(input: string): StripResult {
  const out: string[] = [];
  const focusLines: number[] = [];
  let open = false;
  let openLine = -1;

  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (START.test(line)) {
      if (open) {
        throw new Error(
          `Focus marker error: [!focus:start] inside an open region. (line ${lineNumber})`,
        );
      }
      open = true;
      openLine = lineNumber;
      continue;
    }
    if (END.test(line)) {
      if (!open) {
        throw new Error(
          `Focus marker error: [!focus:end] without a matching [!focus:start]. (line ${lineNumber})`,
        );
      }
      open = false;
      continue;
    }

    const inline = INLINE.test(line);
    let text = line;
    if (inline) {
      text = line.replace(INLINE, "");
      if (text.trim() === "") {
        // The whole line was a focus marker; drop it, like a region marker.
        continue;
      }
    }

    if (RESIDUAL_MARKER.test(text)) {
      throw new Error(
        `Focus marker error: unrecognized "[!focus...]" on line ${lineNumber} — a marker must end its line ("code; // [!focus]") or stand alone as [!focus:start] / [!focus:end].`,
      );
    }

    out.push(text);
    if (inline || open) focusLines.push(out.length);
  }

  if (open) {
    throw new Error(
      `Focus marker error: [!focus:start] without a matching [!focus:end]. (line ${openLine})`,
    );
  }
  return { source: out.join("\n"), focusLines };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-markers.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/docs/examples/markers.ts apps/website/lib/docs/__tests__/examples-markers.test.ts
git commit -m "feat(docs): in-source focus marker parsing for examples"
```

---

### Task 3: Loader

`loadExampleFiles` takes a directory and metadata, so it is testable against a temp directory without adding a fixture example to the real registry. `loadExample` is the thin registry-aware wrapper added in Task 6, once `registry.generated.ts` exists.

**Files:**
- Create: `apps/website/lib/docs/examples/load.ts`
- Test: `apps/website/lib/docs/__tests__/examples-load.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/examples-load.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadExampleFiles } from "../examples/load";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pretable-example-"));
  await fs.writeFile(
    path.join(dir, "Grid.tsx"),
    [
      'import { PretableSurface } from "@pretable/react";',
      "",
      "export function Grid() {",
      "  return <PretableSurface groupPanel={{ enabled: true }} />; // [!focus]",
      "}",
      "",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "columns.ts"),
    "export const columns = [];\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "broken.ts"),
    "// [!focus:start]\nexport const a = 1;\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, "trailing-focus.ts"),
    [
      "export const a = 1;",
      "// [!focus:start]",
      "export const b = 2;",
      "",
      "",
      "// [!focus:end]",
      "",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.mkdir(path.join(dir, "a-directory.ts"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("loadExampleFiles", () => {
  it("returns files in declared order with inferred languages", async () => {
    const files = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx", "columns.ts"],
    });
    expect(files.map((f) => f.path)).toEqual(["Grid.tsx", "columns.ts"]);
    expect(files.map((f) => f.lang)).toEqual(["tsx", "ts"]);
  });

  it("strips focus markers and trims trailing blank lines from source", async () => {
    const [grid] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx"],
    });
    expect(grid.source).not.toMatch(/\[!focus/);
    expect(grid.source.endsWith("}")).toBe(true);
    expect(grid.focusLines).toEqual([4]);
  });

  it("marks focused lines in the highlighted html", async () => {
    const [grid] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["Grid.tsx"],
    });
    expect(grid.html).not.toMatch(/\[!focus/);

    // Pinned against real Shiki 4.4.2 output: one `.line` span per source
    // line, so this can't pass by marking every line or the wrong one.
    const lines = grid.html.split("\n");
    expect(lines.filter((l) => l.includes("line-focus"))).toHaveLength(1);
    expect(lines[3]).toContain("line-focus"); // 0-based; source line 4
    expect(lines[3]).toContain("PretableSurface");
  });

  it("marks no lines when a file has no focus markers", async () => {
    const [columns] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["columns.ts"],
    });
    expect(columns.focusLines).toEqual([]);
    expect(columns.html).not.toContain("line-focus");
  });

  it("names the file in the error when it is missing from disk", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["nope.ts"],
      }),
    ).rejects.toThrow(/not found on disk.*nope\.ts/);
  });

  it("reports the real cause, not 'not found', when the declared file is a directory", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["a-directory.ts"],
      }),
    ).rejects.toThrow(/could not be read \(EISDIR\).*a-directory\.ts/);
  });

  it("names the file in the error when its markers are unbalanced", async () => {
    await expect(
      loadExampleFiles(dir, {
        title: "T",
        description: "D",
        files: ["broken.ts"],
      }),
    ).rejects.toThrow(/broken\.ts/);
  });

  it("drops focus lines that fall past the end after trailing blank lines are trimmed", async () => {
    const [file] = await loadExampleFiles(dir, {
      title: "T",
      description: "D",
      files: ["trailing-focus.ts"],
    });
    const lineCount = file.source.split("\n").length;
    for (const line of file.focusLines) {
      expect(line).toBeLessThanOrEqual(lineCount);
    }
    // The region covers "export const b = 2;" plus two blank lines before
    // [!focus:end]; the blank lines are trimmed away by trimEnd(), so only
    // the surviving line should remain focused.
    expect(file.focusLines).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-load.test.ts`
Expected: FAIL — cannot resolve `../examples/load`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/website/lib/docs/examples/load.ts
import fs from "node:fs/promises";
import path from "node:path";

import { codeToHtml, type BundledLanguage, type BundledTheme } from "shiki";

import {
  langForFile,
  type ExampleLang,
  type ExampleMeta,
  type LoadedFile,
} from "./define";
import { stripFocusMarkers, type StripResult } from "./markers";

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

    // `trimEnd` can delete lines a focus region covered, which would leave
    // `focusLines` pointing past the end of `source` and make the contract
    // documented on `LoadedFile.focusLines` false. Filter first, then build the
    // highlighter's lookup from the same list so HTML and data agree.
    const source = stripped.source.trimEnd();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-load.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/docs/examples/load.ts apps/website/lib/docs/__tests__/examples-load.test.ts
git commit -m "feat(docs): example file loader with focus-aware highlighting"
```

---

### Task 4: URLs and markdown serializer

**Files:**
- Create: `apps/website/lib/docs/examples/urls.ts`
- Create: `apps/website/lib/docs/examples/serialize.ts`
- Test: `apps/website/lib/docs/__tests__/examples-serialize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/examples-serialize.test.ts
import { describe, expect, it } from "vitest";

import type { LoadedExample } from "../examples/define";
import { exampleCatalogLine, toMarkdown } from "../examples/serialize";
import { exampleCanonicalUrl, examplePath } from "../examples/urls";

const example: LoadedExample = {
  id: "grouping-panel",
  meta: {
    title: "Drag-to-group panel",
    description: "Enable the grouping panel.",
    files: ["Grid.tsx", "columns.ts"],
  },
  hasDemo: true,
  files: [
    {
      path: "Grid.tsx",
      lang: "tsx",
      source: "export function Grid() {}",
      html: "<pre/>",
      focusLines: [],
    },
    {
      path: "columns.ts",
      lang: "ts",
      source: "export const columns = [];",
      html: "<pre/>",
      focusLines: [],
    },
  ],
};

describe("example urls", () => {
  it("uses the public .md convention", () => {
    expect(examplePath("grouping-panel")).toBe("/examples/grouping-panel.md");
    expect(exampleCanonicalUrl("grouping-panel")).toBe(
      "https://pretable.ai/examples/grouping-panel.md",
    );
  });
});

describe("toMarkdown", () => {
  it("emits title, description, a derived Source line, and path-labelled fences", () => {
    expect(toMarkdown(example)).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://pretable.ai/examples/grouping-panel.md",
        "",
        "```tsx Grid.tsx",
        "export function Grid() {}",
        "```",
        "",
        "```ts columns.ts",
        "export const columns = [];",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("uses an explicit canonicalUrl instead of the derived one, at the same position", () => {
    expect(toMarkdown(example, { canonicalUrl: "https://x.test/a.md" })).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://x.test/a.md",
        "",
        "```tsx Grid.tsx",
        "export function Grid() {}",
        "```",
        "",
        "```ts columns.ts",
        "export const columns = [];",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("emits the heading at a caller-chosen level, defaulting to 3", () => {
    expect(toMarkdown(example).split("\n")[0]).toBe(
      "### Example: Drag-to-group panel",
    );
    expect(toMarkdown(example, { headingLevel: 1 }).split("\n")[0]).toBe(
      "# Example: Drag-to-group panel",
    );
    expect(toMarkdown(example, { headingLevel: 4 }).split("\n")[0]).toBe(
      "#### Example: Drag-to-group panel",
    );
  });

  it("widens the fence for a JSDoc comment quoting a fenced block (over-widening, not corruption)", () => {
    const withJsDocFence: LoadedExample = {
      ...example,
      files: [
        {
          path: "docs.ts",
          lang: "ts",
          source: [
            "/**",
            " * Example:",
            " * ```ts",
            " * const x = 1;",
            " * ```",
            " */",
          ].join("\n"),
          html: "<pre/>",
          focusLines: [],
        },
      ],
    };
    const out = toMarkdown(withJsDocFence);
    expect(out).toContain("````ts docs.ts");
    // The inner triple-backtick run must survive untouched, and the fence
    // that closes the file block must be the widened one, not a bare ```.
    expect(out).toContain(" * ```ts\n * const x = 1;\n * ```\n");
    const fenceLines = out.split("\n").filter((line) => /^`+/.test(line));
    expect(fenceLines).toEqual(["````ts docs.ts", "````"]);
  });

  it("widens the fence for a column-0 triple-backtick run — the real corruption case", () => {
    const withHeredocFence: LoadedExample = {
      ...example,
      files: [
        {
          path: "readme.sh",
          lang: "bash",
          source: ["cat <<'EOF'", "```", "example markdown", "```", "EOF"].join(
            "\n",
          ),
          html: "<pre/>",
          focusLines: [],
        },
      ],
    };
    // A bare ``` wrapper fence would be closed early by the heredoc's own
    // ``` line, which sits at column 0 like a real closer, truncating
    // everything the agent reads after it — so the wrapper must widen to
    // four backticks while the heredoc's own ``` lines pass through
    // untouched. Byte-exact so the wrapper fence can't be confused with the
    // content's own backtick lines.
    expect(toMarkdown(withHeredocFence)).toBe(
      [
        "### Example: Drag-to-group panel",
        "",
        "Enable the grouping panel.",
        "",
        "Source: https://pretable.ai/examples/grouping-panel.md",
        "",
        "````bash readme.sh",
        "cat <<'EOF'",
        "```",
        "example markdown",
        "```",
        "EOF",
        "````",
        "",
      ].join("\n"),
    );
  });
});

describe("exampleCatalogLine", () => {
  it("formats a single llms.txt catalog entry", () => {
    expect(exampleCatalogLine(example.id, example.meta)).toBe(
      "- [Drag-to-group panel](/examples/grouping-panel.md): Enable the grouping panel.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-serialize.test.ts`
Expected: FAIL — cannot resolve `../examples/serialize`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/website/lib/docs/examples/urls.ts

/**
 * Public origin of the docs site. Deliberately not derived from
 * `VERCEL_URL` or any other deploy-time env var: a canonical `Source:` url
 * must point at production from every preview deploy and from localhost
 * alike, since that's the one place the cited url is actually reachable.
 * Known, invisible consequence: on a preview deploy of a brand-new example,
 * the `Source:` line cites a production url that 404s until the branch
 * merges — that is expected, not a bug to "fix" by wiring this to the
 * deploy's own origin.
 */
export const SITE_ORIGIN = "https://pretable.ai";

/**
 * Public path for an example's markdown. `proxy.ts` rewrites this to the
 * `/examples-md/<id>` route, mirroring how `/docs/<slug>.md` reaches
 * `/docs-md/<slug>`.
 */
export function examplePath(id: string): string {
  return `/examples/${id}.md`;
}

export function exampleCanonicalUrl(id: string): string {
  return SITE_ORIGIN + examplePath(id);
}
```

```ts
// apps/website/lib/docs/examples/serialize.ts
import type { ExampleMeta, LoadedExample } from "./define";
import { exampleCanonicalUrl, examplePath } from "./urls";

export interface ToMarkdownOptions {
  /**
   * Heading level for the `Example: <title>` line. Defaults to 3, which is
   * correct when this markdown is spliced into a docs page that already
   * opens with a `# title` (inline expansion, Task 8) — the example heading
   * should sit a level below the page's own. The per-example standalone
   * route (Task 9) serves this markdown as its own document, so it passes
   * `1` to make the example title the document's root heading. This heading
   * exists only in the markdown serialization — the React shell renders the
   * title in a `div`, and the page's table of contents is extracted from
   * pre-expansion MDX — so its level is purely a boundary marker for
   * agents, which is why callers choose it rather than it being fixed.
   */
  headingLevel?: 1 | 2 | 3 | 4;
  /**
   * Overrides the derived `Source:` url. Defaults to
   * `exampleCanonicalUrl(example.id)`, so every call site gets a traceable
   * `Source:` line without re-deriving the url itself — this option exists
   * mainly so tests can pin an arbitrary url instead of the real one.
   */
  canonicalUrl?: string;
}

/**
 * Returns a fence long enough that no backtick run already present in
 * `content` can close it early.
 *
 * The genuine corruption case is a backtick run that starts at column 0 of
 * its own line — e.g. a heredoc or template literal quoting markdown —
 * which a bare ``` fence would read as its own closer, truncating
 * everything after it. A JSDoc comment quoting a fenced block
 * (` * \`\`\`ts `) would NOT actually corrupt anything under CommonMark,
 * since a closing fence must be a line of only backticks (with at most
 * three leading spaces), and `` * `` isn't that. This function widens on
 * ANY backtick run anywhere in the content regardless — indented, prefixed,
 * wherever — which is deliberately stricter than CommonMark requires: the
 * payload here is read by lenient markdown parsers and by LLMs, not just
 * strict CommonMark implementations, and over-widening the fence costs
 * nothing.
 */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The single markdown representation of an example. Every agent-facing surface
 * — inline expansion, the per-example route, copy-for-agent, llms-full.txt —
 * goes through here, so what an agent reads cannot drift from what a reader
 * sees on the page.
 */
export function toMarkdown(
  example: LoadedExample,
  opts: ToMarkdownOptions = {},
): string {
  const level = opts.headingLevel ?? 3;
  const url = opts.canonicalUrl ?? exampleCanonicalUrl(example.id);
  const lines: string[] = [
    `${"#".repeat(level)} Example: ${example.meta.title}`,
    "",
    example.meta.description,
    "",
    `Source: ${url}`,
  ];
  for (const file of example.files) {
    const fence = fenceFor(file.source);
    lines.push("", `${fence}${file.lang} ${file.path}`, file.source, fence);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * A single `llms.txt` catalog line for an example — title, link,
 * description. `llms.txt`'s builder (Task 10) calls this instead of
 * assembling the same markdown link shape by hand, so the catalog entry
 * can't drift from the url convention `urls.ts` owns.
 */
export function exampleCatalogLine(id: string, meta: ExampleMeta): string {
  return `- [${meta.title}](${examplePath(id)}): ${meta.description}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-serialize.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/docs/examples/urls.ts apps/website/lib/docs/examples/serialize.ts apps/website/lib/docs/__tests__/examples-serialize.test.ts
git commit -m "feat(docs): single markdown serializer for examples"
```

---

### Task 5: Registry codegen

Codegen exists to do the one thing runtime JS cannot: emit static imports. Output must be prettier-clean, because `pnpm format` runs `prettier --check .` in CI.

**Files:**
- Create: `apps/website/scripts/gen-example-registry.mjs`
- Modify: `apps/website/package.json`

- [ ] **Step 1: Write the generator**

```js
// apps/website/scripts/gen-example-registry.mjs
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EXAMPLES = path.join(ROOT, "content/examples");
const OUT_DIR = path.join(ROOT, "lib/docs/examples");
const REGISTRY = path.join(OUT_DIR, "registry.generated.ts");
const DEMOS = path.join(OUT_DIR, "demos.generated.ts");

const BANNER =
  "// Generated by `pnpm examples:gen`. Do not edit.\n" +
  "// Add an example by creating content/examples/<slug>/example.ts.\n";

function identifier(slug) {
  return slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function discover() {
  if (!fs.existsSync(EXAMPLES)) return [];
  return fs
    .readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((slug) => fs.existsSync(path.join(EXAMPLES, slug, "example.ts")))
    .sort()
    .map((slug) => ({
      slug,
      ident: identifier(slug),
      hasDemo: fs.existsSync(path.join(EXAMPLES, slug, "demo.tsx")),
    }));
}

function renderRegistry(entries) {
  const imports = entries
    .map((e) => `import ${e.ident} from "../../../content/examples/${e.slug}/example";`)
    .join("\n");
  const body = entries
    .map(
      (e) =>
        `  "${e.slug}": { meta: ${e.ident}, hasDemo: ${e.hasDemo} },`,
    )
    .join("\n");
  return `${BANNER}
${imports}

export const exampleRegistry = {
${body}
} as const;

export type ExampleId = keyof typeof exampleRegistry;

export const exampleIds = Object.keys(exampleRegistry) as ExampleId[];
`;
}

function renderDemos(entries) {
  const withDemo = entries.filter((e) => e.hasDemo);
  const imports = withDemo
    .map((e) => `import ${e.ident}Demo from "../../../content/examples/${e.slug}/demo";`)
    .join("\n");
  const body = withDemo
    .map((e) => `  "${e.slug}": ${e.ident}Demo,`)
    .join("\n");
  return `${BANNER}
import type { ComponentType } from "react";

${imports}

import type { ExampleId } from "./registry.generated";

export const exampleDemos: Partial<Record<ExampleId, ComponentType>> = {
${body}
};
`;
}

const entries = discover();
const outputs = [
  [REGISTRY, renderRegistry(entries)],
  [DEMOS, renderDemos(entries)],
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([file, want]) => {
    const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    return have !== want;
  });
  if (stale.length > 0) {
    console.error(
      "Example registry is stale:\n" +
        stale.map(([f]) => `  ${path.relative(ROOT, f)}`).join("\n") +
        "\n\nRun `pnpm --filter @pretable/app-website examples:gen` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`Example registry is current (${entries.length} examples).`);
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, contents] of outputs) fs.writeFileSync(file, contents, "utf8");
  console.log(`Wrote registry for ${entries.length} examples.`);
}
```

- [ ] **Step 2: Wire the scripts**

In `apps/website/package.json`, add to `"scripts"` (keep alphabetical placement consistent with the existing block):

```json
    "examples:check": "node ./scripts/gen-example-registry.mjs --check",
    "examples:gen": "node ./scripts/gen-example-registry.mjs",
```

and add the generator to the three pre-scripts so local work cannot drift:

```json
    "predev": "pnpm run prepare:deps && pnpm run examples:gen",
    "prebuild": "pnpm run prepare:deps && pnpm run examples:gen",
    "pretest": "pnpm run prepare:deps && pnpm run examples:gen",
```

- [ ] **Step 3: Run the generator against the current (unmigrated) tree**

Run from `apps/website`: `pnpm examples:gen`
Expected: `Wrote registry for 0 examples.` — no folder has `example.ts` yet. Two generated files now exist with empty maps.

- [ ] **Step 4: Verify `--check` agrees, and that formatting is clean**

Run: `pnpm examples:check`
Expected: `Example registry is current (0 examples).`

Run from the repo root: `pnpm exec prettier --check apps/website/lib/docs/examples/*.generated.ts`
Expected: "All matched files use Prettier code style!" If not, run `pnpm exec prettier --write` on those files, copy the exact formatting back into the template strings in the generator, re-run `pnpm examples:gen`, and re-check. The generator must produce prettier-clean output on its own — do not leave a `--write` step in the pipeline.

- [ ] **Step 5: Commit**

```bash
git add apps/website/scripts/gen-example-registry.mjs apps/website/package.json apps/website/lib/docs/examples/registry.generated.ts apps/website/lib/docs/examples/demos.generated.ts
git commit -m "build(docs): generate the example registry from folder contents"
```

---

### Task 6: Migrate the three existing examples

`streaming-chat-grid`'s demo currently lives in `MockChatGrid.tsx`, which is a folder file that the example never shows. Renaming it to `demo.tsx` is what makes the folder satisfy the "every source file is declared" guard in Task 11.

**Files:**
- Create: `apps/website/content/examples/grouping-panel/example.ts`, `demo.tsx`
- Create: `apps/website/content/examples/headless-custom-renderer/example.ts`, `demo.tsx`
- Create: `apps/website/content/examples/streaming-chat-grid/example.ts`
- Rename: `apps/website/content/examples/streaming-chat-grid/MockChatGrid.tsx` → `demo.tsx`
- Modify: `apps/website/content/examples/streaming-chat-grid/__tests__/MockChatGrid.test.tsx`
- Delete: `apps/website/content/examples/*/index.tsx` (all three)
- Modify: `apps/website/lib/docs/examples/load.ts` (add `loadExample`)

- [ ] **Step 1: Write `grouping-panel`**

```ts
// apps/website/content/examples/grouping-panel/example.ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Drag-to-group panel",
  description:
    "Enable the grouping panel and drag column headers in to build levels. The query is controlled so the current levels can be shown outside the grid.",
  files: ["GroupingPanelGrid.tsx", "columns.ts", "data.ts"],
});
```

```tsx
// apps/website/content/examples/grouping-panel/demo.tsx
import { GroupingPanelGrid } from "./GroupingPanelGrid";

export default function Demo() {
  return <GroupingPanelGrid />;
}
```

- [ ] **Step 2: Write `headless-custom-renderer`**

```ts
// apps/website/content/examples/headless-custom-renderer/example.ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Headless custom renderer",
  description:
    "Drive your own markup from the @pretable/core row model with useSyncExternalStore — no grid renderer involved.",
  files: ["HeadlessTable.tsx", "columns.ts", "data.ts"],
});
```

```tsx
// apps/website/content/examples/headless-custom-renderer/demo.tsx
import { HeadlessTable } from "./HeadlessTable";

export default function Demo() {
  return <HeadlessTable />;
}
```

- [ ] **Step 3: Move the streaming demo into the conventional filename**

```bash
git mv apps/website/content/examples/streaming-chat-grid/MockChatGrid.tsx apps/website/content/examples/streaming-chat-grid/demo.tsx
```

Then edit `demo.tsx`: keep the existing named export `MockChatGrid` exactly as it is (its unit test imports it by name) and add a default export at the end of the file:

```tsx
export default function Demo() {
  return <MockChatGrid />;
}
```

Update the test's import path in `apps/website/content/examples/streaming-chat-grid/__tests__/MockChatGrid.test.tsx`:

```ts
import { MockChatGrid } from "../demo";
```

```ts
// apps/website/content/examples/streaming-chat-grid/example.ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Streaming chat grid",
  description:
    "Connect a token-streaming source to a pretable grid. Selection and focus survive every chunk.",
  files: ["ChatGrid.tsx", "columns.ts", "response-events-to-chat-rows.ts"],
});
```

- [ ] **Step 4: Add `loadExample` to the loader**

Append to `apps/website/lib/docs/examples/load.ts`:

```ts
import { exampleRegistry, type ExampleId } from "./registry.generated";
import type { LoadedExample } from "./define";

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
```

Move the two `import` statements to the top of the file with the others; the code block above shows them inline only for locality.

- [ ] **Step 5: Delete the old per-example loaders**

```bash
git rm apps/website/content/examples/grouping-panel/index.tsx \
       apps/website/content/examples/headless-custom-renderer/index.tsx \
       apps/website/content/examples/streaming-chat-grid/index.tsx
```

This breaks `app/components/CodeExample.tsx` and the two MDX wrapper components until Task 7. That is expected; Tasks 6 and 7 land as one working state.

- [ ] **Step 6: Regenerate and inspect the registry**

Run from `apps/website`: `pnpm examples:gen`
Expected: `Wrote registry for 3 examples.`

Read `lib/docs/examples/registry.generated.ts` and confirm all three slugs are present with `hasDemo: true`.

- [ ] **Step 7: Verify the loader resolves a real example**

Run: `pnpm exec vitest run content/examples/streaming-chat-grid/__tests__/MockChatGrid.test.tsx`
Expected: PASS — proves the `demo.tsx` rename and import update are correct.

- [ ] **Step 8: Commit**

```bash
git add -A apps/website/content/examples apps/website/lib/docs/examples
git commit -m "refactor(docs): move the three examples onto the folder convention"
```

---

### Task 7: The component

**Files:**
- Create: `apps/website/app/components/docs/mdx/ExampleShell.tsx`
- Modify (replace whole file): `apps/website/app/components/docs/mdx/Example.tsx`
- Modify: `apps/website/app/components/docs/MdxRenderer.tsx`
- Modify: `apps/website/app/components/CodeExample.tsx`
- Modify: `apps/website/app/globals.css`
- Modify: `apps/website/content/docs/grid/grouping.mdx`, `apps/website/content/docs/headless/getting-started.mdx`
- Delete: `apps/website/app/components/docs/mdx/GroupingExample.tsx`, `HeadlessExample.tsx`, `apps/website/lib/docs/define-example.ts`
- Replace: `apps/website/app/components/docs/mdx/__tests__/Example.test.tsx` → `ExampleShell.test.tsx`

- [ ] **Step 1: Write the failing shell test**

```tsx
// apps/website/app/components/docs/mdx/__tests__/ExampleShell.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExampleShell, type ExampleShellProps } from "../ExampleShell";

const files = [
  { path: "a.ts", lang: "ts", source: "export const a = 1;", html: "<pre>A</pre>" },
  { path: "b.ts", lang: "ts", source: "export const b = 2;", html: "<pre>B</pre>" },
];

// `children` is passed as a prop, never as a JSX child: nested children always
// win over a spread, so a `{ children: null }` override would be ignored and
// the demo-less test would silently assert nothing.
function renderShell(overrides: Partial<ExampleShellProps> = {}) {
  const props: ExampleShellProps = {
    title: "Demo",
    description: "A demo.",
    height: 480,
    files,
    agentMarkdown: "### Example: Demo\n",
    mdHref: "/examples/demo.md",
    initial: "preview",
    children: <div>LIVE</div>,
    ...overrides,
  };
  return render(<ExampleShell {...props} />);
}

describe("ExampleShell", () => {
  it("shows title and description", () => {
    renderShell();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("A demo.")).toBeInTheDocument();
  });

  it("offers Preview and Code tabs when a demo is present", () => {
    renderShell();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Code" })).toBeInTheDocument();
  });

  it("keeps the demo mounted while the Code pane is active", () => {
    renderShell();
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    // Still in the DOM: switching panes must not tear down a grid the reader
    // has already grouped, scrolled, or selected in.
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders no Preview tab for a demo-less example", () => {
    renderShell({ children: null, initial: "code" });
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
  });

  it("switches file tabs", () => {
    renderShell({ initial: "code" });
    fireEvent.click(screen.getByRole("tab", { name: "b.ts" }));
    expect(screen.getByRole("tab", { name: "b.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves file-tab selection with the right arrow key", () => {
    renderShell({ initial: "code" });
    const first = screen.getByRole("tab", { name: "a.ts" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "b.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("copies the active file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell({ initial: "code" });
    fireEvent.click(screen.getByRole("button", { name: /copy file/i }));
    expect(writeText).toHaveBeenCalledWith("export const a = 1;");
  });

  it("copies the agent bundle verbatim", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /copy for agent/i }));
    expect(writeText).toHaveBeenCalledWith("### Example: Demo\n");
  });

  it("applies the example height to the pane", () => {
    const { container } = renderShell({ height: 300 });
    const pane = container.querySelector<HTMLElement>("[data-example-pane]");
    expect(pane?.style.height).toBe("300px");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/components/docs/mdx/__tests__/ExampleShell.test.tsx`
Expected: FAIL — cannot resolve `../ExampleShell`.

- [ ] **Step 3: Write the shell**

```tsx
// apps/website/app/components/docs/mdx/ExampleShell.tsx
"use client";

import { useRef, useState, type ReactNode } from "react";

export interface ShellFile {
  path: string;
  lang: string;
  source: string;
  html: string;
}

export interface ExampleShellProps {
  title: string;
  description: string;
  height: number;
  files: readonly ShellFile[];
  agentMarkdown: string;
  mdHref: string;
  initial: "preview" | "code";
  children?: ReactNode;
}

export function ExampleShell({
  title,
  description,
  height,
  files,
  agentMarkdown,
  mdHref,
  initial,
  children,
}: ExampleShellProps) {
  const hasDemo = children != null;
  const [view, setView] = useState<"preview" | "code">(
    hasDemo ? initial : "code",
  );
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const file = files[active];

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = (index + delta + files.length) % files.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <figure className="my-6 overflow-hidden rounded-md border border-rule bg-bg-card">
      <div className="border-b border-rule px-3 py-2.5">
        <div className="text-[13px] font-semibold text-text-primary">{title}</div>
        <p className="mt-0.5 text-[12px] leading-[1.45] text-text-secondary">
          {description}
        </p>
      </div>

      <div className="flex items-center border-b border-rule bg-bg-card/40 px-2">
        <div role="tablist" aria-label="Example view" className="flex">
          {hasDemo && (
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              tabIndex={view === "preview" ? 0 : -1}
              onClick={() => setView("preview")}
              className={`border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
                view === "preview"
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              Preview
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={view === "code"}
            tabIndex={view === "code" ? 0 : -1}
            onClick={() => setView("code")}
            className={`border-b-2 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.11em] ${
              view === "code"
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            Code
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5 py-1.5">
          {view === "code" && (
            <button
              type="button"
              onClick={() => copy("file", file.source)}
              className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
            >
              {copied === "file" ? "Copied" : "Copy file"}
            </button>
          )}
          <button
            type="button"
            onClick={() => copy("agent", agentMarkdown)}
            className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            {copied === "agent" ? "Copied" : "Copy for agent"}
          </button>
          <a
            href={mdHref}
            className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            .md
          </a>
        </div>
      </div>

      {view === "code" && files.length > 1 && (
        <div
          role="tablist"
          aria-label="Example files"
          className="flex border-b border-rule px-2"
        >
          {files.map((f, i) => (
            <button
              key={f.path}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              aria-selected={i === active}
              tabIndex={i === active ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)}
              onClick={() => setActive(i)}
              className={`border-b-2 px-2.5 py-1.5 font-mono text-[10.5px] ${
                i === active
                  ? "border-rule-strong text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {f.path}
            </button>
          ))}
        </div>
      )}

      {/*
        Both panes stay laid out. The inactive one is faded and made inert
        rather than unmounted or `display: none`-d: unmounting would reset a
        demo the reader has already interacted with, and `display: none` gives
        a virtualized grid a zero-height container to measure against.
      */}
      <div
        data-example-pane
        className="relative overflow-hidden"
        style={{ height }}
      >
        {hasDemo && (
          <div
            className={`absolute inset-0 overflow-auto p-3 transition-opacity ${
              view === "preview" ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            aria-hidden={view !== "preview"}
            inert={view !== "preview" ? "" : undefined}
          >
            {children}
          </div>
        )}
        <div
          className={`pretable-example-code absolute inset-0 overflow-auto ${
            view === "code" ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
          aria-hidden={view !== "code"}
          inert={view !== "code" ? "" : undefined}
          dangerouslySetInnerHTML={{ __html: file.html }}
        />
      </div>
    </figure>
  );
}
```

- [ ] **Step 4: Run the shell test**

Run: `pnpm exec vitest run app/components/docs/mdx/__tests__/ExampleShell.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the server component**

Replace the entire contents of `apps/website/app/components/docs/mdx/Example.tsx`:

```tsx
// apps/website/app/components/docs/mdx/Example.tsx
import { DEFAULT_EXAMPLE_HEIGHT } from "../../../../lib/docs/examples/define";
import { exampleDemos } from "../../../../lib/docs/examples/demos.generated";
import { loadExample } from "../../../../lib/docs/examples/load";
import type { ExampleId } from "../../../../lib/docs/examples/registry.generated";
import { toMarkdown } from "../../../../lib/docs/examples/serialize";
import { examplePath } from "../../../../lib/docs/examples/urls";
import { ExampleShell } from "./ExampleShell";

export interface ExampleProps {
  id: ExampleId;
  /** Open on the source when the code, not the behavior, is the lesson. */
  initial?: "preview" | "code";
}

export async function Example({ id, initial }: ExampleProps) {
  const example = await loadExample(id);
  const Demo = exampleDemos[id];
  return (
    <ExampleShell
      title={example.meta.title}
      description={example.meta.description}
      height={example.meta.height ?? DEFAULT_EXAMPLE_HEIGHT}
      files={example.files.map((f) => ({
        path: f.path,
        lang: f.lang,
        source: f.source,
        html: f.html,
      }))}
      agentMarkdown={toMarkdown(example)}
      mdHref={examplePath(id)}
      initial={initial ?? (Demo ? "preview" : "code")}
    >
      {Demo ? <Demo /> : null}
    </ExampleShell>
  );
}
```

- [ ] **Step 6: Add the pane and focus styles**

Append to `apps/website/app/globals.css`:

```css
/* Running examples: Shiki output inside the Code pane.
   `.line-focus` is applied by the example loader from focus markers in the
   source; when a file marks any line, the rest are dimmed. */
.pretable-example-code pre {
  margin: 0;
  padding: 0.75rem 1rem;
  background: transparent;
  font-size: 12.5px;
  line-height: 1.55;
}

.pretable-example-code code {
  background: transparent;
}

.pretable-example-code:has(.line-focus) .line:not(.line-focus) {
  opacity: 0.42;
}
```

- [ ] **Step 7: Rewire the consumers**

`apps/website/app/components/docs/MdxRenderer.tsx` — drop the `GroupingExample` and `HeadlessExample` imports and map entries, keeping `Example`.

`apps/website/content/docs/grid/grouping.mdx` line 10 — replace `<GroupingExample />` with:

```mdx
<Example id="grouping-panel" />
```

`apps/website/content/docs/headless/getting-started.mdx` line 86 — replace `<HeadlessExample />` with:

```mdx
<Example id="headless-custom-renderer" />
```

`apps/website/app/components/CodeExample.tsx` — replace the import and the usage:

```tsx
import { Example } from "./docs/mdx/Example";
```

```tsx
        <div className="mt-8">
          <Example id="streaming-chat-grid" initial="code" />
        </div>
```

`CodeExample` is already rendered from a server component tree, so awaiting inside `Example` is fine. If the file is marked `"use client"`, remove that directive — it holds no client state.

- [ ] **Step 8: Delete the dead files**

```bash
git rm apps/website/app/components/docs/mdx/GroupingExample.tsx \
       apps/website/app/components/docs/mdx/HeadlessExample.tsx \
       apps/website/lib/docs/define-example.ts \
       apps/website/app/components/docs/mdx/__tests__/Example.test.tsx
```

- [ ] **Step 9: Verify the whole website suite and a real build**

Run from `apps/website`: `pnpm test`
Expected: PASS. Any remaining reference to `define-example` or the deleted wrappers surfaces here.

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds. This is the first proof that Shiki, the registry, and RSC composition work together in a real Next build.

- [ ] **Step 10: Commit**

```bash
git add -A apps/website
git commit -m "feat(docs): Preview/Code example component driven by the registry"
```

---

### Task 8: Inline expansion in the markdown surfaces

**Files:**
- Create: `apps/website/lib/docs/examples/expand.ts`
- Test: `apps/website/lib/docs/__tests__/examples-expand.test.ts`
- Modify: `apps/website/lib/docs/raw-response.ts`
- Modify: `apps/website/app/llms-full.txt/build.ts`
- Modify: `apps/website/app/docs-md/[[...slug]]/route.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/examples-expand.test.ts
import { describe, expect, it } from "vitest";

import type { LoadedExample } from "../examples/define";
import { expandExamples } from "../examples/expand";

const fake = async (id: string): Promise<LoadedExample> => {
  if (id !== "demo-a") throw new Error(`Unknown example id: "${id}"`);
  return {
    id,
    meta: { title: "Demo A", description: "Does a thing.", files: ["a.ts"] },
    hasDemo: true,
    files: [
      {
        path: "a.ts",
        lang: "ts",
        source: "export const a = 1;",
        html: "<pre/>",
        focusLines: [],
      },
    ],
  };
};

describe("expandExamples", () => {
  it("leaves a document with no Example tags byte-identical", async () => {
    const raw = "# Title\n\nSome prose.\n\n```ts\nconst a = 1;\n```\n";
    expect(await expandExamples(raw, fake)).toBe(raw);
  });

  it("replaces the tag with the serialized bundle", async () => {
    const out = await expandExamples(
      'Before\n\n<Example id="demo-a" />\n\nAfter\n',
      fake,
    );
    expect(out).toContain("### Example: Demo A");
    expect(out).toContain("```ts a.ts");
    expect(out).toContain("export const a = 1;");
    expect(out).not.toContain("<Example");
    expect(out.startsWith("Before")).toBe(true);
    expect(out.trimEnd().endsWith("After")).toBe(true);
  });

  it("expands every occurrence, including tags with extra props", async () => {
    const out = await expandExamples(
      '<Example id="demo-a" />\n<Example initial="code" id="demo-a" />\n',
      fake,
    );
    expect(out.match(/### Example: Demo A/g)).toHaveLength(2);
  });

  it("throws on an id no example provides", async () => {
    await expect(
      expandExamples('<Example id="nope" />', fake),
    ).rejects.toThrow(/nope/);
  });

  it("throws when the tag has no id", async () => {
    await expect(expandExamples("<Example />", fake)).rejects.toThrow(
      /without an `id`/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-expand.test.ts`
Expected: FAIL — cannot resolve `../examples/expand`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/website/lib/docs/examples/expand.ts
import type { LoadedExample } from "./define";
import { loadExample } from "./load";
import type { ExampleId } from "./registry.generated";
import { toMarkdown } from "./serialize";

const TAG = /<Example\b([^>]*?)\/>/g;
const ID_ATTR = /\bid\s*=\s*"([^"]+)"/;

type Loader = (id: string) => Promise<LoadedExample>;

const defaultLoader: Loader = (id) => loadExample(id as ExampleId);

/**
 * Rewrites `<Example id="…" />` tags in a raw MDX source into their full
 * markdown bundle. Without this, `/docs/<slug>.md` and `/llms-full.txt` hand an
 * agent a bare JSX tag and none of the code the page is teaching.
 */
export async function expandExamples(
  raw: string,
  load: Loader = defaultLoader,
): Promise<string> {
  const ids: string[] = [];
  for (const match of raw.matchAll(TAG)) {
    const id = ID_ATTR.exec(match[1])?.[1];
    if (!id) {
      throw new Error(
        `Found an <Example /> tag without an \`id\` attribute: ${match[0]}`,
      );
    }
    ids.push(id);
  }
  if (ids.length === 0) return raw;

  const rendered = new Map<string, string>();
  for (const id of new Set(ids)) {
    const example = await load(id);
    rendered.set(id, toMarkdown(example));
  }

  return raw.replace(TAG, (whole, attrs: string) => {
    const id = ID_ATTR.exec(attrs)?.[1];
    return (id && rendered.get(id)) ?? whole;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-expand.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire both markdown surfaces**

`apps/website/lib/docs/raw-response.ts` becomes async:

```ts
import { expandExamples } from "./examples/expand";
import type { DocsFrontmatter } from "./paths";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

export async function buildRawMarkdownResponse(args: {
  frontmatter: DocsFrontmatter;
  raw: string;
}): Promise<Response> {
  const body = await expandExamples(args.raw.replace(FRONTMATTER_RE, ""));
  const text = `# ${args.frontmatter.title}\n\n${args.frontmatter.description}\n\n${body}`;
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
```

In `apps/website/app/docs-md/[[...slug]]/route.ts`, add `await` to the call:

```ts
  return await buildRawMarkdownResponse({
    frontmatter: result.frontmatter,
    raw: result.raw,
  });
```

In `apps/website/app/llms-full.txt/build.ts`, expand the body:

```ts
import { expandExamples } from "../../lib/docs/examples/expand";
```

```ts
    const body = await expandExamples(raw.replace(FRONTMATTER_RE, ""));
```

- [ ] **Step 6: Verify against the real grouping page**

Run from `apps/website`: `pnpm build && pnpm start &` then, once the server is up:

```bash
curl -s http://localhost:3000/docs/grid/grouping.md | grep -c 'GroupingPanelGrid.tsx'
```

Expected: `1` or more, and no occurrence of `<Example`. Stop the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add apps/website/lib/docs/examples/expand.ts apps/website/lib/docs/__tests__/examples-expand.test.ts apps/website/lib/docs/raw-response.ts apps/website/app/docs-md apps/website/app/llms-full.txt
git commit -m "feat(docs): expand examples inline in raw markdown and llms-full.txt"
```

---

### Task 9: Per-example markdown route

**Files:**
- Create: `apps/website/app/examples-md/[slug]/route.ts`
- Modify: `apps/website/proxy.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/website/app/examples-md/[slug]/route.ts
import { notFound } from "next/navigation";

import { loadExample } from "../../../lib/docs/examples/load";
import {
  exampleRegistry,
  type ExampleId,
} from "../../../lib/docs/examples/registry.generated";
import { toMarkdown } from "../../../lib/docs/examples/serialize";

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(exampleRegistry).map((slug) => ({ slug }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(slug in exampleRegistry)) notFound();
  const example = await loadExample(slug as ExampleId);
  return new Response(toMarkdown(example, { headingLevel: 1 }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Extend the proxy rewrite**

Replace `apps/website/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

export const config = { matcher: ["/docs/:path*", "/examples/:path*"] };

export function proxy(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (!url.pathname.endsWith(".md")) return;
  if (url.pathname.startsWith("/docs/")) {
    url.pathname = "/docs-md" + url.pathname.slice(5).replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
  if (url.pathname.startsWith("/examples/")) {
    url.pathname = "/examples-md" + url.pathname.slice(9).replace(/\.md$/, "");
    return NextResponse.rewrite(url);
  }
}
```

`"/docs/".length` is 5 and `"/examples/".length` is 9; the slice drops the prefix while keeping the leading slash of the remainder.

- [ ] **Step 3: Verify against a running build**

Run from `apps/website`: `pnpm build && pnpm start &` then:

```bash
curl -s http://localhost:3000/examples/grouping-panel.md | head -5
```

Expected: `# Example: Drag-to-group panel` (heading level 1, since this route serves the example as a standalone document), the description, and the `Source:` line. Stop the server afterwards.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/examples-md apps/website/proxy.ts
git commit -m "feat(docs): serve each example as standalone markdown"
```

---

### Task 10: Examples section in `llms.txt`

**Files:**
- Modify: `apps/website/app/llms.txt/build.ts`
- Test: `apps/website/lib/docs/__tests__/llms-examples.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/lib/docs/__tests__/llms-examples.test.ts
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildLlmsTxt } from "../../../app/llms.txt/build";
import { docsNav } from "../../../app/docs/_nav";
import { exampleCatalogLine } from "../examples/serialize";
import { exampleRegistry } from "../examples/registry.generated";

const ROOT = path.join(process.cwd(), "content/docs");

describe("llms.txt", () => {
  it("lists every registered example under an Examples heading", async () => {
    const text = await buildLlmsTxt(ROOT, docsNav);
    expect(text).toContain("## Examples");
    for (const [id, entry] of Object.entries(exampleRegistry)) {
      expect(text).toContain(exampleCatalogLine(id, entry.meta));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/docs/__tests__/llms-examples.test.ts`
Expected: FAIL — `expected … to contain "## Examples"`.

- [ ] **Step 3: Add the section**

In `apps/website/app/llms.txt/build.ts`, add the imports:

```ts
import { exampleRegistry } from "../../lib/docs/examples/registry.generated";
import { exampleCatalogLine } from "../../lib/docs/examples/serialize";
```

and append this block immediately before `return lines.join("\n");`:

```ts
  const examples = Object.entries(exampleRegistry);
  if (examples.length > 0) {
    lines.push("## Examples");
    for (const [id, entry] of examples) {
      lines.push(exampleCatalogLine(id, entry.meta));
    }
    lines.push("");
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/docs/__tests__/llms-examples.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/llms.txt/build.ts apps/website/lib/docs/__tests__/llms-examples.test.ts
git commit -m "feat(docs): list the example catalog in llms.txt"
```

---

### Task 11: Registry guard tests

A guard that cannot see the thing it guards reads as coverage while providing none. Each check below is proven to fail by mutation before this task is considered done.

**Files:**
- Test: `apps/website/lib/docs/__tests__/examples-registry-guard.test.ts`

- [ ] **Step 1: Write the guard suite**

```ts
// apps/website/lib/docs/__tests__/examples-registry-guard.test.ts
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadExample } from "../examples/load";
import { exampleRegistry } from "../examples/registry.generated";
import { toMarkdown } from "../examples/serialize";

const ROOT = process.cwd();
const EXAMPLES = path.join(ROOT, "content/examples");
const IDS = Object.keys(exampleRegistry);

/** Files a folder owns by convention; they are never shown as example source. */
const CONVENTIONAL = new Set(["example.ts", "demo.tsx"]);

function walk(dir: string, filter: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const docsFiles = walk(path.join(ROOT, "content/docs"), (f) => f.endsWith(".mdx"));
const appFiles = walk(path.join(ROOT, "app"), (f) => f.endsWith(".tsx"));
const sources = [...docsFiles, ...appFiles].map((f) => ({
  file: path.relative(ROOT, f),
  text: fs.readFileSync(f, "utf8"),
}));

function referencedIds(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/<Example\b[^>]*?\bid\s*=\s*"([^"]+)"/g)) {
      const list = found.get(m[1]) ?? [];
      list.push(file);
      found.set(m[1], list);
    }
  }
  return found;
}

describe("example registry", () => {
  it("has at least one example (a vacuously-passing suite is a bug)", () => {
    expect(IDS.length).toBeGreaterThan(0);
  });

  it("every registered id has a folder with an example.ts", () => {
    for (const id of IDS) {
      expect(
        fs.existsSync(path.join(EXAMPLES, id, "example.ts")),
        `content/examples/${id}/example.ts is missing`,
      ).toBe(true);
    }
  });

  it("hasDemo agrees with the presence of demo.tsx", () => {
    for (const id of IDS) {
      expect(
        exampleRegistry[id as keyof typeof exampleRegistry].hasDemo,
        `hasDemo is wrong for ${id}; run \`pnpm examples:gen\``,
      ).toBe(fs.existsSync(path.join(EXAMPLES, id, "demo.tsx")));
    }
  });

  it("every declared file exists on disk", () => {
    for (const id of IDS) {
      for (const f of exampleRegistry[id as keyof typeof exampleRegistry].meta
        .files) {
        expect(
          fs.existsSync(path.join(EXAMPLES, id, f)),
          `content/examples/${id}/${f} is declared but missing`,
        ).toBe(true);
      }
    }
  });

  it("every source file in a folder is declared", () => {
    for (const id of IDS) {
      const declared = new Set(
        exampleRegistry[id as keyof typeof exampleRegistry].meta.files,
      );
      const onDisk = fs
        .readdirSync(path.join(EXAMPLES, id), { withFileTypes: true })
        .filter((e) => e.isFile() && !CONVENTIONAL.has(e.name))
        .map((e) => e.name);
      for (const f of onDisk) {
        expect(
          declared.has(f),
          `content/examples/${id}/${f} exists but no reader will ever see it — add it to \`files\`, fold it into demo.tsx, or delete it`,
        ).toBe(true);
      }
    }
  });

  it("every <Example id> in docs and app resolves to a registered example", () => {
    for (const [id, files] of referencedIds()) {
      expect(IDS, `${id} is referenced by ${files.join(", ")}`).toContain(id);
    }
  });

  it("every registered example is referenced somewhere", () => {
    const referenced = referencedIds();
    for (const id of IDS) {
      expect(
        referenced.has(id),
        `example "${id}" is not referenced by any docs page or app component`,
      ).toBe(true);
    }
  });

  it("the reference scan can actually see the docs pages", () => {
    // Guards that scan the wrong files pass green forever. Pin the corpus.
    expect(docsFiles.length).toBeGreaterThan(10);
    expect(referencedIds().size).toBeGreaterThan(0);
  });

  it("no focus marker survives into displayed source or agent markdown", async () => {
    for (const id of IDS) {
      const example = await loadExample(id as keyof typeof exampleRegistry);
      for (const file of example.files) {
        expect(file.source, `${id}/${file.path}`).not.toMatch(/\[!focus/);
        expect(file.html, `${id}/${file.path}`).not.toMatch(/\[!focus/);
      }
      expect(toMarkdown(example)).not.toMatch(/\[!focus/);
    }
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm exec vitest run lib/docs/__tests__/examples-registry-guard.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 3: Prove each guard fails when the thing it guards is broken**

Perform each mutation, run the suite, confirm the named test fails, then revert. A guard that survives its mutation is not done.

| Mutation | Test that must fail |
| --- | --- |
| Add `"nope.ts"` to `files` in `content/examples/grouping-panel/example.ts` | every declared file exists on disk |
| `touch apps/website/content/examples/grouping-panel/Scratch.tsx` | every source file in a folder is declared |
| Change `<Example id="grouping-panel" />` to `id="grouping-panl"` in `grouping.mdx` | every `<Example id>` … resolves |
| Delete the `<Example id="headless-custom-renderer" />` line from `headless/getting-started.mdx` | every registered example is referenced |
| Add `// [!focus]` to a line of `columns.ts`, then hand-edit `markers.ts` to return the line unchanged | no focus marker survives |
| Flip `hasDemo` to `false` for one entry in `registry.generated.ts` | hasDemo agrees with the presence of demo.tsx |

Run after each revert: `pnpm exec vitest run lib/docs/__tests__/examples-registry-guard.test.ts` — back to PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/website/lib/docs/__tests__/examples-registry-guard.test.ts
git commit -m "test(docs): fail-closed guards for the example registry"
```

---

### Task 12: CI freshness gate and end-to-end smoke

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `apps/website/e2e/example-component.spec.ts`

- [ ] **Step 1: Add the freshness job**

In `.github/workflows/ci.yml`, add after the `format` job, matching the surrounding job shape exactly:

```yaml
  examples:
    name: Example registry — freshness
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pretable/app-website examples:check
```

- [ ] **Step 2: Verify the gate locally, both ways**

Run from the repo root: `pnpm --filter @pretable/app-website examples:check`
Expected: `Example registry is current (3 examples).`

Now break it: delete the last line of `apps/website/lib/docs/examples/registry.generated.ts` and re-run.
Expected: exit code 1 and the "Example registry is stale" message naming that file.

Restore with `pnpm --filter @pretable/app-website examples:gen`, then re-run `examples:check`.
Expected: back to current.

- [ ] **Step 3: Write the smoke test**

```ts
// apps/website/e2e/example-component.spec.ts
import { expect, test } from "@playwright/test";

test("example toggles between Preview and Code without resetting the demo", async ({
  page,
}) => {
  await page.goto("/docs/grid/grouping");

  const figure = page.locator("figure", { hasText: "Drag-to-group panel" });
  // SSR'd controls are painted but inert; clicking before hydration is
  // silently dropped, which is the single most common flake here.
  await expect(figure.locator("[data-pretable-hydrated]").first()).toBeVisible();

  const grid = figure.getByRole("treegrid").or(figure.getByRole("grid")).first();
  await expect(grid).toBeVisible();

  await figure.getByRole("tab", { name: "Code" }).click();
  await expect(figure.getByRole("tab", { name: "GroupingPanelGrid.tsx" })).toBeVisible();

  await figure.getByRole("tab", { name: "Preview" }).click();
  // The demo was never unmounted, so the same grid node is still here.
  await expect(grid).toBeVisible();
});
```

- [ ] **Step 4: Run the smoke test**

Run from `apps/website`: `pnpm build && pnpm exec playwright test e2e/example-component.spec.ts --workers=1`
Expected: PASS. The website e2e suite needs a real `next build` + `next start` and one worker; the dev server does not work for it.

If the demo's accessible role does not match, read the rendered DOM and fix the locator rather than loosening the assertion — the point of the test is that the *same* node survives the toggle.

- [ ] **Step 5: Full verification**

Run from the repo root:

```bash
pnpm --filter @pretable/app-website test
```

```bash
pnpm --filter @pretable/app-website typecheck
```

```bash
pnpm --filter @pretable/app-website lint
```

```bash
pnpm format
```

Expected: all four pass. If `pnpm format` fails on the generated files, fix the generator's template (Task 5, Step 4) rather than reformatting the output by hand.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml apps/website/e2e/example-component.spec.ts
git commit -m "ci(docs): gate example registry freshness and smoke the component"
```

---

## Done when

- `<Example id="…" />` is the only example component registered in `MdxRenderer`, and adding an example means creating one folder.
- `curl /docs/grid/grouping.md` returns the full three-file source instead of a JSX tag.
- `curl /examples/grouping-panel.md` returns the standalone bundle.
- `/llms.txt` has an `## Examples` section.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, and `pnpm --filter @pretable/app-website examples:check` all pass, and every guard in Task 11 has been shown to fail under its mutation.

## Follow-up, not in this plan

Combing the docs for places to adopt the component. That pass starts once this lands, and its scope is a separate decision.
