/**
 * The classic-JSX-runtime guard.
 *
 * `tsdown.config.ts` builds this package with
 * `transform.jsx = { runtime: "classic", pragma: "createElement",
 * pragmaFrag: "Fragment" }`. Under that runtime the compiler does NOT inject
 * anything: `<div/>` becomes a call to whatever `createElement` is in scope,
 * and `<>…</>` becomes a call to whatever `Fragment` is in scope. A shipped
 * `.tsx` that renders JSX without importing those names from `"react"`
 * therefore compiles, type-checks and lints cleanly, and then throws
 * `Fragment is not defined` in the consumer's browser.
 *
 * Vitest cannot see it. The test runner transforms with esbuild's default
 * AUTOMATIC runtime, which imports `jsx`/`Fragment` from `react/jsx-runtime`
 * itself — so the unit suite renders the component happily while the built
 * artifact is broken. That is exactly what happened to `PretableSelect`
 * (fixed in 119d5b80): 1844 unit tests green, every production render dead.
 *
 * So this test reads the SOURCE rather than executing it.
 *
 * Heuristic, for the JSX scan: comments and string/template literals are
 * stripped first, then:
 *   - JSX is "a `<` that starts a tag" — `<` followed by a letter or by `>`,
 *     and NOT preceded by an identifier character, `.`, `)` or `]`. The
 *     preceding-character rule is what separates JSX (`return <div>`,
 *     `{cond ? <A/> : null}`) from a generic type argument
 *     (`useState<DOMRect>`, `forwardRef<HTMLButtonElement, Props>`).
 *   - a fragment is `<>` or `<Fragment`.
 *
 * The import scan (`reactImportedNames`) strips only COMMENTS, not strings —
 * stripping strings too would blank out the `"react"` module specifier
 * itself and make every import invisible to the scan. Skipping the
 * string-strip is safe here because the scan only needs to see the import
 * statement's shape, not anything inside a string value. It also binds each
 * name by where it lands in scope: `import { createElement as h }` binds
 * `h`, not `createElement` — the classic pragma needs the bare name
 * `createElement` in scope, and an aliased import does not put it there.
 *
 * Known blind spots, all of which fail SAFE (a missed file is not a false
 * accusation, and the mutation check below proves the detector still bites):
 *   - regex literals are not tracked by either stripper, so a regex
 *     containing a quote or a slash could desynchronise it;
 *   - JSX interpolated inside a template literal is stripped away with the
 *     template;
 *   - `import * as React from "react"` + `React.createElement` is not
 *     recognised as an import of the pragma names (this package does not use
 *     that form, and the classic pragmas here are bare identifiers anyway);
 *   - a spaced comparison written as `a <b` reads as a tag.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/** Every `.tsx` under `src`, excluding the test directories. */
async function shippedTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      found.push(...(await shippedTsxFiles(full)));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found.sort();
}

/**
 * Blanks out line comments, block comments and string/template literals,
 * preserving length so nothing shifts. Regex literals are not tracked — see
 * the blind spots above.
 */
function stripCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        j += 1;
      }
      blank(i, Math.min(j + 1, source.length));
      i = Math.min(j + 1, source.length);
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * Blanks out line and block comments only, leaving string/template literals
 * untouched — used for the import scan, where the `"react"` specifier itself
 * is a string literal we still need to see. Quotes are tracked (without
 * blanking) purely so a `//` or `/*` sitting inside a string doesn't get
 * mistaken for the start of a real comment.
 */
function stripComments(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        j += 1;
      }
      i = Math.min(j + 1, source.length);
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * Names imported from `"react"` by a named import, across any number of
 * lines. Reads the comment-stripped source (see `stripComments`) so a
 * mention of a pragma name inside a comment is never mistaken for a real
 * import. An aliased specifier (`x as y`) is recorded as `y`: that is the
 * only name the alias actually puts in scope, and the classic-runtime
 * pragmas require the bare original name.
 */
function reactImportedNames(source: string): Set<string> {
  const names = new Set<string>();
  const code = stripComments(source);
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']react["']/g;
  for (const match of code.matchAll(pattern)) {
    for (const raw of match[1].split(",")) {
      const cleaned = raw.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const bound = parts.length > 1 ? parts[1] : parts[0];
      if (bound) names.add(bound.trim());
    }
  }
  return names;
}

const JSX_TAG = /(?<![A-Za-z0-9_$.\])])<(?:[A-Za-z]|>)/;
const FRAGMENT = /(?<![A-Za-z0-9_$.\])])(?:<>|<Fragment)/;

it("reactImportedNames ignores a react import written inside a comment", () => {
  const source = `// import { createElement, Fragment } from "react";\nconst x = 1;`;
  const imported = reactImportedNames(source);
  expect(imported.has("createElement")).toBe(false);
  expect(imported.has("Fragment")).toBe(false);
});

it("reactImportedNames treats an aliased import as not binding the original name", () => {
  const source = `import { createElement as h } from "react";`;
  const imported = reactImportedNames(source);
  expect(imported.has("createElement")).toBe(false);
  expect(imported.has("h")).toBe(true);
});

it("reactImportedNames sees a multi-line import", () => {
  const source = `import {\n  createElement,\n  Fragment,\n} from "react";`;
  const imported = reactImportedNames(source);
  expect(imported.has("createElement")).toBe(true);
  expect(imported.has("Fragment")).toBe(true);
});

it("every shipped .tsx imports the pragmas the classic JSX build calls", async () => {
  const files = await shippedTsxFiles(SRC);
  expect(files.length).toBeGreaterThan(10);

  const missingCreateElement: string[] = [];
  const missingFragment: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const code = stripCommentsAndStrings(source);
    const imported = reactImportedNames(source);
    const rel = path.relative(SRC, file);

    if (JSX_TAG.test(code) && !imported.has("createElement")) {
      missingCreateElement.push(rel);
    }
    if (FRAGMENT.test(code) && !imported.has("Fragment")) {
      missingFragment.push(rel);
    }
  }

  expect({ missingCreateElement, missingFragment }).toEqual({
    missingCreateElement: [],
    missingFragment: [],
  });
});

it("pins the build config the guard exists for", async () => {
  const config = await readFile(
    path.join(process.cwd(), "tsdown.config.ts"),
    "utf8",
  );
  expect(config).toContain('runtime: "classic"');
  expect(config).toContain('pragma: "createElement"');
  expect(config).toContain('pragmaFrag: "Fragment"');
});
