import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { DEFAULT_EXAMPLE_HEIGHT } from "../examples/define";
import { EXAMPLES_ROOT, exampleDir } from "../examples/load";
import { loadExample } from "../examples/registry";
import {
  exampleRegistry,
  type ExampleId,
} from "../examples/registry.generated";
import { toMarkdown } from "../examples/serialize";

/**
 * Reads the same `--docs-code-size` / `--docs-code-leading` tokens the code
 * pane actually renders at (see globals.css's `.docs-code-type`) — not a
 * hardcoded guess at the type scale, or this guard drifts from the pane it's
 * guarding the moment either value is retuned.
 */
function readDocsCodeTypeScale(): { fontSizePx: number; leading: number } {
  const globalsCss = path.join(process.cwd(), "app", "globals.css");
  const css = fs.readFileSync(globalsCss, "utf8");
  const sizeMatch = css.match(/--docs-code-size:\s*([\d.]+)px/);
  const leadingMatch = css.match(/--docs-code-leading:\s*([\d.]+)/);
  if (!sizeMatch || !leadingMatch) {
    throw new Error(
      `Could not find --docs-code-size / --docs-code-leading in ${globalsCss}. ` +
        "The focus-placement guard's visible-window formula reads these " +
        "directly — if they were renamed or restructured, update the regex " +
        "in this file too.",
    );
  }
  return { fontSizePx: Number(sizeMatch[1]), leading: Number(leadingMatch[1]) };
}

/**
 * How many lines of code fit in a pane of `paneHeightPx`, at the type scale
 * the pane actually renders at. Not a hardcoded 27 — see the design doc's
 * "Focus placement becomes a guard" section.
 */
function visibleLineWindow(paneHeightPx: number): number {
  const { fontSizePx, leading } = readDocsCodeTypeScale();
  return Math.floor(paneHeightPx / (fontSizePx * leading));
}

/**
 * The registry, and every `<Example id="…" />` reference to it, is
 * hand-authored: a folder added under `content/examples/` without an entry
 * in `files`, a demo removed without flipping `hasDemo`, a docs page
 * pointing at a typo'd id — none of that fails a build, because
 * `scripts/gen-example-registry.mjs` only warns about a missing
 * `example.ts` and is silent about everything else. This file is the
 * fail-closed half.
 *
 * Every check below is proven, by deliberate mutation, to actually fail —
 * see the plan's mutation table. A check that cannot be shown to fail
 * against a broken system is not a guard, it's decoration.
 */

const EXAMPLES_DIR = path.join(process.cwd(), EXAMPLES_ROOT);
const DOCS_ROOT = path.join(process.cwd(), "content/docs");
const APP_ROOT = path.join(process.cwd(), "app");

const REGISTERED_IDS = Object.keys(exampleRegistry) as ExampleId[];

const CONVENTIONAL_FILES = new Set(["example.ts", "demo.tsx"]);

function relPosix(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}

/**
 * Every file under `dir`, recursively, excluding any directory literally
 * named `__tests__`. Returns paths relative to `dir` with posix separators.
 *
 * Missing `dir` returns `[]` rather than throwing — a check reading an
 * absent corpus must fail its own assertion with a clear message, not blow
 * up the whole suite with an unrelated ENOENT.
 */
function walkRelative(dir: string, excludeDirNames: Set<string>): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirNames.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        out.push(relPosix(dir, full));
      }
    }
  };
  walk(dir);
  return out;
}

/** Every file under `dir`, recursively, whose extension is in `extensions`. */
function walkByExtension(dir: string, extensions: Set<string>): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// <Example id="…" /> reference scan — shared by checks 7, 8, 9.
// ---------------------------------------------------------------------------

const DOCS_FILES = walkByExtension(DOCS_ROOT, new Set([".mdx"]));
const APP_FILES = walkByExtension(APP_ROOT, new Set([".tsx"]));
const SCAN_FILES = [...DOCS_FILES, ...APP_FILES];

const EXAMPLE_TAG_RE = /<Example\s+id=["']([^"']+)["']/g;

interface ExampleRef {
  id: string;
  file: string;
}

function findExampleRefs(files: readonly string[]): ExampleRef[] {
  const refs: ExampleRef[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    for (const match of raw.matchAll(EXAMPLE_TAG_RE)) {
      refs.push({ id: match[1] as string, file });
    }
  }
  return refs;
}

const EXAMPLE_REFS = findExampleRefs(SCAN_FILES);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

describe("examples registry guard", () => {
  test("the registry is non-empty", () => {
    // A guard suite that passes because it found nothing is the failure
    // mode this whole file exists to prevent — every check below is
    // vacuously true over an empty registry.
    expect(
      REGISTERED_IDS.length,
      `lib/docs/examples/registry.generated.ts has no entries. If this is ` +
        `expected, every check in this file is now vacuous and cannot be ` +
        `trusted. If content/examples/ actually has folders, run ` +
        "`pnpm examples:gen`.",
    ).toBeGreaterThan(0);
  });

  test("every registered id has a folder containing example.ts", () => {
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const file = path.join(exampleDir(id), "example.ts");
      if (!fs.existsSync(file)) broken.push(`"${id}": missing ${file}`);
    }
    expect(
      broken,
      `Registered example(s) with no example.ts on disk:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nRun `pnpm examples:gen` to regenerate the registry, or restore " +
        "the missing folder/file.",
    ).toEqual([]);
  });

  test("hasDemo agrees with demo.tsx", () => {
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const entry = exampleRegistry[id];
      const demoExists = fs.existsSync(path.join(exampleDir(id), "demo.tsx"));
      if (entry.hasDemo !== demoExists) {
        broken.push(
          `"${id}": registry says hasDemo=${entry.hasDemo}, but demo.tsx ` +
            `${demoExists ? "exists" : "does not exist"} at ${exampleDir(id)}`,
        );
      }
    }
    expect(
      broken,
      `registry.generated.ts's hasDemo disagrees with demo.tsx on disk:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nThis file is generated — run `pnpm examples:gen` and commit " +
        "the result rather than hand-editing it.",
    ).toEqual([]);
  });

  test("every declared file exists on disk", () => {
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const dir = exampleDir(id);
      for (const file of exampleRegistry[id].meta.files) {
        const full = path.join(dir, file);
        if (!fs.existsSync(full)) {
          broken.push(
            `"${id}": files declares "${file}", but ${full} does not exist`,
          );
        }
      }
    }
    expect(
      broken,
      `Example(s) declare a file in meta.files that is not on disk:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nFix the path in that example's example.ts, or add the missing " +
        "file.",
    ).toEqual([]);
  });

  test("every source file in a folder is declared", () => {
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const dir = exampleDir(id);
      const declared = new Set(exampleRegistry[id].meta.files);
      const onDisk = walkRelative(dir, new Set(["__tests__"]));
      for (const file of onDisk) {
        if (CONVENTIONAL_FILES.has(file)) continue;
        if (!declared.has(file)) {
          broken.push(
            `"${id}": ${path.join(dir, file)} exists but is not listed in ` +
              `files`,
          );
        }
      }
    }
    expect(
      broken,
      `Example folder(s) contain a source file that no reader will ever ` +
        `see, because it's not in meta.files:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nAdd it to files in that example's example.ts, or delete the " +
        "file if it isn't meant to be part of the example.",
    ).toEqual([]);
  });

  test("every directory contains an example.ts", () => {
    const dirNames = fs
      .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const broken: string[] = [];
    for (const name of dirNames) {
      const file = path.join(EXAMPLES_DIR, name, "example.ts");
      if (!fs.existsSync(file)) broken.push(name);
    }
    expect(
      broken,
      `Folder(s) under ${EXAMPLES_ROOT}/ have no example.ts, so ` +
        "`pnpm examples:gen` silently skips them (they never reach the " +
        "registry, and no reader ever sees them):\n" +
        broken.map((name) => `  ${EXAMPLES_ROOT}/${name}/`).join("\n") +
        "\n\nAdd example.ts (default-exporting ExampleMeta — see " +
        "lib/docs/examples/define.ts), rename a misnamed example.tsx to " +
        "example.ts, or delete the folder if it isn't an example.",
    ).toEqual([]);
  });

  test("the reference scan can see the corpus", () => {
    // Fail closed: every check below (7 and 8) is vacuously true over an
    // empty corpus, and a moved content directory would silently pass.
    expect(
      DOCS_FILES.length,
      `no .mdx files found under ${DOCS_ROOT} — has content/docs moved, or ` +
        "is DOCS_ROOT in this test wrong?",
    ).toBeGreaterThan(10);
    expect(
      APP_FILES.length,
      `no .tsx files found under ${APP_ROOT} — has app/ moved, or is ` +
        "APP_ROOT in this test wrong?",
    ).toBeGreaterThan(20);
    expect(
      EXAMPLE_REFS.length,
      `scanned ${DOCS_FILES.length} .mdx and ${APP_FILES.length} .tsx ` +
        'files but found zero `<Example id="…" />` references. Every ' +
        "registered example is used somewhere, so EXAMPLE_TAG_RE in this " +
        "file is what changed, and it's now reading an empty corpus.",
    ).toBeGreaterThan(0);
  });

  test("every reference resolves", () => {
    const known = new Set(REGISTERED_IDS as string[]);
    const broken: string[] = [];
    for (const ref of EXAMPLE_REFS) {
      if (!known.has(ref.id)) {
        broken.push(
          `${relPosix(process.cwd(), ref.file)}: <Example id="${ref.id}" />` +
            ` does not match any registered example`,
        );
      }
    }
    expect(
      broken,
      `Unresolvable <Example id="…" /> reference(s):\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        `\n\nRegistered ids: ${[...known].sort().join(", ")}.\n` +
        "Fix the id, or add content/examples/<id>/example.ts and run " +
        "`pnpm examples:gen`.",
    ).toEqual([]);
  });

  test("every registered example is referenced", () => {
    const referenced = new Set(EXAMPLE_REFS.map((r) => r.id));
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      if (!referenced.has(id)) broken.push(id);
    }
    expect(
      broken,
      `Registered example(s) with no <Example id="…" /> reference anywhere ` +
        `under content/docs/**/*.mdx or app/**/*.tsx:\n` +
        broken.map((id) => `  "${id}" (content/examples/${id}/)`).join("\n") +
        "\n\nAdd a reference, or delete the example if it's no longer " +
        "needed.",
    ).toEqual([]);
  });

  test("no focus-marker leakage", async () => {
    // No real example currently contains a marker, so this passes
    // vacuously today over the real corpus — see the mutation proof for how
    // it was confirmed to actually fire.
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const example = await loadExample(id);
      for (const file of example.files) {
        if (file.source.includes("[!focus")) {
          broken.push(`"${id}": ${file.path} source still contains [!focus`);
        }
        if (file.html.includes("[!focus")) {
          broken.push(`"${id}": ${file.path} html still contains [!focus`);
        }
      }
      if (toMarkdown(example).includes("[!focus")) {
        broken.push(`"${id}": toMarkdown() output still contains [!focus`);
      }
    }
    expect(
      broken,
      `Focus marker text leaked past stripFocusMarkers:\n` +
        broken.map((b) => `  ${b}`).join("\n"),
    ).toEqual([]);
  });

  test("descriptions are single-line plain prose", () => {
    const LEADING_MARKER_RE = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s)/;
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const description = exampleRegistry[id].meta.description;
      const reasons: string[] = [];
      if (description.includes("\n")) reasons.push("contains a newline");
      if (/`{3,}/.test(description)) {
        reasons.push("contains a backtick fence (```)");
      }
      if (LEADING_MARKER_RE.test(description)) {
        reasons.push("starts with a list or heading marker");
      }
      if (reasons.length > 0) {
        broken.push(`"${id}": ${reasons.join("; ")}`);
      }
    }
    expect(
      broken,
      `meta.description must be single-line plain prose — it's emitted raw ` +
        `into markdown an agent reads, so a fence or blank line inside it ` +
        `corrupts everything after it:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nRewrite the description in that example's example.ts as one " +
        "plain sentence.",
    ).toEqual([]);
  });

  test("focus markers land within the visible window", async () => {
    // The Code pane does not scroll to focus and does not collapse
    // unfocused regions — a focus-marked file has to put the marked lines
    // near the top itself. custom-theme's brand.css failed this at 192
    // lines with its first focused line at index 28, well past what a
    // ~480px pane shows — see the design doc's "Focus placement becomes a
    // guard" section. Confirmed to actually fail by reverting the brand.css
    // reorder that fixed it — see the mutation proof in the PR/commit.
    const broken: string[] = [];
    for (const id of REGISTERED_IDS) {
      const example = await loadExample(id);
      const paneHeight =
        exampleRegistry[id].meta.height ?? DEFAULT_EXAMPLE_HEIGHT;
      const window = visibleLineWindow(paneHeight);
      for (const file of example.files) {
        if (file.focusLines.length === 0) continue;
        const first = Math.min(...file.focusLines);
        if (first > window) {
          broken.push(
            `"${id}": ${file.path} first focused line is ${first}, past the ` +
              `${window}-line visible window (pane height ${paneHeight}px)`,
          );
        }
      }
    }
    expect(
      broken,
      `Focus-marked line(s) fall outside the visible window a reader sees ` +
        `without scrolling:\n` +
        broken.map((b) => `  ${b}`).join("\n") +
        "\n\nReorder that file so the marked lines come before any long " +
        "unmarked preamble (an explanatory header comment, for example).",
    ).toEqual([]);
  });
});
