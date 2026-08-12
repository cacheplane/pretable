import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

/**
 * The docs are hand-authored prose about a generated API. Four times now a
 * hand-maintained claim has drifted from the code and shipped green:
 *
 *   1. `grid/api-reference.mdx`'s `PretableColumn` table lost five fields (#273).
 *   2. `grid/pretable-surface.mdx`'s props table omitted ten shipped props and
 *      had `viewportHeight` / `getRowId` optionality backwards.
 *   3. Eleven pages taught `import { useResolvedHeights } from "@pretable/react"`
 *      — a name the package exports only as `ɵuseResolvedHeights`, so every one
 *      of those snippets was a compile error against the published package.
 *   4. `theming/token-reference.mdx` documented 39 of the 49 `--pretable-*`
 *      tokens the themes ship, and still documented
 *      `--pretable-reorder-ghost-shadow` after it was renamed to
 *      `--pretable-shadow-overlay` — by then a name that existed nowhere in the
 *      repo, in a page whose whole job is to be the list of names. Not one
 *      check in this file could see it: the member-table detector fires only on
 *      a first header of `prop`/`field`/`option`/`method`, and that table leads
 *      with `Token`.
 *
 * `pnpm build` cannot see any of it: MDX compiles fenced code as text, and the
 * tables are just tables. So this file compares the docs against the API
 * Extractor reports (`packages/<pkg>/<pkg>.api.md`) — files we already generate
 * and already gate on freshness in CI — and, for the theming surface, against
 * `packages/ui`'s own token contract and theme stylesheets.
 *
 * Seven checks, each aimed at one of the ways the four incidents happened:
 *
 *   - **imports** — every identifier a fenced block imports from `@pretable/*`
 *     must be an export in that package's report. Catches (3) in code.
 *   - **internal names** — a name the package exports only under the `ɵ`
 *     ("internal, not public API") prefix must not appear anywhere in the docs
 *     under its bare name, prose included. Catches (3) in prose, which the
 *     import check cannot see — and most of (3)'s eleven pages were prose.
 *   - **member tables** — a table documenting a type's members is checked
 *     against that type in the report, both ways: no invented member, no
 *     omitted one, and `Required` must agree with optionality. Catches (1)
 *     and (2).
 *   - **the roster** — every member table in the docs must be named in
 *     {@link TABLES}, bound to a type or explicitly excused with a reason.
 *   - **token names** — the token reference must name exactly the tokens in the
 *     {@link CONTRACT_TEST} presence list, both ways: no shipped token left
 *     undocumented, no documented token that no theme defines. Catches (4).
 *   - **token values** — a literal in a per-theme column must equal that
 *     theme's own `:root` declaration. Catches the other half of (4): a rename
 *     moves a name, a retheme moves the values under names that still look
 *     right.
 *   - **theme paths** — every `@pretable/ui/themes/<name>.css` the docs import
 *     must be a stylesheet the package ships. Existence only: WHICH theme a
 *     page imports is editorial, and a page about the Excel skin should import
 *     `excel.css`. What no page may do is send the reader to a theme that is
 *     not there — a dead `@import` throws nothing, so the reader gets an
 *     unstyled grid and no clue why.
 *
 * The roster is what makes this self-enforcing, and it is the lesson of
 * `packages/grid-core/src/__tests__/column-model-reconciliation-invariant.test.ts`
 * (#266): a checker over a hand-picked list of things to check is itself a
 * hand-maintained list that drifts. A new props table cannot be added silently
 * — the author is forced to say which type it documents, and the check then
 * holds it to that type. The judgement call the author is NOT allowed to make
 * is whether their table needs checking. The token checks get the same
 * treatment for free: their expected set is read out of the contract test, so
 * a token added there is documented or the suite is red.
 *
 * Fail closed everywhere: an unreadable report, an unknown `@pretable/*`
 * package, a table nobody registered, a token contract this file can no longer
 * parse, or a docs corpus that appears to import no themes at all is a
 * failure, not a skip.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const DOCS_ROOT = path.join(__dirname, "../../../content/docs");

/** `@pretable/<pkg>` → `packages/<pkg>/<pkg>.api.md`. */
function reportPathFor(pkg: string): string {
  return path.join(REPO_ROOT, "packages", pkg, `${pkg}.api.md`);
}

const REMEDY_REGENERATE = [
  "If the report is the thing that is stale, regenerate it:",
  "  pnpm --filter @pretable/<pkg> build && pnpm api",
  "Otherwise the docs are wrong — fix the docs, not this test.",
].join("\n");

// ---------------------------------------------------------------------------
// API Extractor report parsing
// ---------------------------------------------------------------------------

interface TypeMember {
  name: string;
  optional: boolean;
}

interface ApiReport {
  pkg: string;
  /** Every exported name, `ɵ`-prefixed ones included. */
  exports: Set<string>;
  /** Members of each exported `interface`, by interface name. */
  members: Map<string, TypeMember[]>;
}

const EXPORT_RE =
  /^export (?:declare )?(?:abstract )?(?:async )?(?:function|const|let|var|class|interface|type|enum|namespace)\s+([^\s(<:={;]+)/gm;

/**
 * A member declaration at the interface's own indent level. Anchored at exactly
 * four spaces so that members of a nested object literal (eight spaces) and the
 * report's `// (undocumented)` / `// Warning:` comment lines are both skipped.
 */
const MEMBER_RE = /^ {4}(?:readonly )?([A-Za-z_$][A-Za-z0-9_$]*)(\?)?\s*[:(]/;

function parseReport(pkg: string): ApiReport {
  const file = reportPathFor(pkg);
  let raw: string;

  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `No API Extractor report for "@pretable/${pkg}" at ${path.relative(REPO_ROOT, file)}.\n` +
        "The docs import from this package, so it must publish a report. " +
        "Add one to its api-extractor config, or fix the import in the docs.",
    );
  }

  const exports = new Set<string>();

  for (const match of raw.matchAll(EXPORT_RE)) {
    exports.add(match[1] as string);
  }

  const members = new Map<string, TypeMember[]>();
  const lines = raw.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const open = /^export interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
      lines[i] as string,
    );

    if (!open) continue;

    // API Extractor can wrap a generic default whose conditional constraint
    // contains an object literal. Find the opening brace after the generic's
    // angle brackets close; otherwise `readonly id` in `TRow extends { id: … }`
    // is mistaken for a public interface member.
    let bodyStart = i;
    let angleDepth = 0;
    for (; bodyStart < lines.length; bodyStart += 1) {
      for (const char of lines[bodyStart] as string) {
        if (char === "<") angleDepth += 1;
        else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
      }
      if (
        angleDepth === 0 &&
        (lines[bodyStart] as string).trimEnd().endsWith("{")
      ) {
        break;
      }
    }

    const collected: TypeMember[] = [];

    for (let j = bodyStart + 1; j < lines.length && lines[j] !== "}"; j += 1) {
      const member = MEMBER_RE.exec(lines[j] as string);

      if (member) {
        collected.push({
          name: member[1] as string,
          optional: member[2] === "?",
        });
      }
    }

    members.set(open[1] as string, collected);
  }

  return { pkg, exports, members };
}

const reportCache = new Map<string, ApiReport>();

function report(pkg: string): ApiReport {
  let cached = reportCache.get(pkg);

  if (!cached) {
    cached = parseReport(pkg);
    reportCache.set(pkg, cached);
  }

  return cached;
}

/** Packages that publish a report, for the internal-name sweep. */
const REPORTED_PACKAGES = fs
  .readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(reportPathFor(name)))
  .sort();

// ---------------------------------------------------------------------------
// Docs parsing
// ---------------------------------------------------------------------------

interface DocsPage {
  /** Path relative to `content/docs`, e.g. `grid/density-helpers.mdx`. */
  rel: string;
  raw: string;
}

function readDocsPages(): DocsPage[] {
  const out: DocsPage[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(".mdx")) {
        out.push({
          rel: path.relative(DOCS_ROOT, full).split(path.sep).join("/"),
          raw: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };

  walk(DOCS_ROOT);
  out.sort((a, b) => a.rel.localeCompare(b.rel));

  return out;
}

const PAGES = readDocsPages();

const FENCE_RE = /^```[^\n]*\n([\s\S]*?)^```/gm;

function fencedBlocks(raw: string): string[] {
  return [...raw.matchAll(FENCE_RE)].map((match) => match[1] as string);
}

/** Everything outside fenced blocks — prose, headings, tables. */
function withoutFences(raw: string): string {
  return raw.replace(FENCE_RE, "");
}

/**
 * The clause may wrap over lines but never crosses a `;`, so a preceding
 * `import … from "react";` cannot be swallowed into the next statement's match.
 */
const IMPORT_RE =
  /\bimport\s+(?:type\s+)?([^;]*?)\s+from\s+["'](@pretable\/[^"']+)["']/g;

interface DocsImport {
  page: string;
  pkg: string;
  identifier: string;
}

/**
 * Named and default identifiers imported from bare `@pretable/*` specifiers.
 * `import * as ns` contributes nothing checkable; subpath specifiers
 * (`@pretable/ui/grid.css`) are assets, not API.
 */
function docsImports(page: DocsPage): DocsImport[] {
  const out: DocsImport[] = [];

  for (const block of fencedBlocks(page.raw)) {
    for (const match of block.matchAll(IMPORT_RE)) {
      const specifier = match[2] as string;
      const pkg = specifier.slice("@pretable/".length);

      if (pkg.includes("/")) continue;

      const clause = (match[1] as string).trim();
      const braces = /\{([\s\S]*)\}/.exec(clause);
      const names: string[] = [];

      const beforeBraces = braces
        ? clause.slice(0, clause.indexOf("{"))
        : clause;
      const defaultName = beforeBraces.replace(/,\s*$/, "").trim();

      if (defaultName && !defaultName.startsWith("*")) {
        names.push(defaultName);
      }

      if (braces) {
        for (const raw of (braces[1] as string).split(",")) {
          const specifierName = raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim();

          if (specifierName) names.push(specifierName);
        }
      }

      for (const identifier of names) {
        out.push({ page: page.rel, pkg, identifier });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

interface DocsTable {
  /**
   * `grid/pretable-surface.mdx#Props` — stable across table edits. A heading
   * holding several tables OF THE SAME KIND disambiguates with ` (table 2)`,
   * ` (table 3)`. Numbering is per kind so that adding, say, a token table
   * under a heading cannot renumber a member table's key out from under
   * {@link TABLES}.
   */
  key: string;
  page: string;
  heading: string;
  headers: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Every GFM table on a page, in document order, with the heading it sits under.
 * Kept kind-agnostic: what a table is FOR is the caller's judgement, and each
 * kind gets read by exactly one check below.
 */
function docsTables(page: DocsPage): Omit<DocsTable, "key">[] {
  const lines = withoutFences(page.raw).split("\n");
  const out: Omit<DocsTable, "key">[] = [];
  let heading = "(top)";

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);

    if (headingMatch) {
      heading = (headingMatch[1] as string).replace(/`/g, "").trim();
      continue;
    }

    if (!line.trimStart().startsWith("|")) continue;

    const headers = splitRow(line);
    const separator = lines[i + 1];
    const isTable =
      typeof separator === "string" && /^\s*\|[\s:|-]+\|\s*$/.test(separator);

    if (!isTable) continue;

    const rows: string[][] = [];
    let j = i + 2;

    for (; j < lines.length; j += 1) {
      const row = lines[j] as string;

      if (!row.trimStart().startsWith("|")) break;

      rows.push(splitRow(row));
    }

    i = j - 1;

    out.push({ page: page.rel, heading, headers, rows });
  }

  return out;
}

/** Tables whose first header says they are of one kind, keyed and numbered. */
function tablesOfKind(
  page: DocsPage,
  isKind: (firstHeader: string) => boolean,
): DocsTable[] {
  const out: DocsTable[] = [];
  const seenPerHeading = new Map<string, number>();

  for (const table of docsTables(page)) {
    if (!isKind((table.headers[0] ?? "").toLowerCase())) continue;

    const nth = (seenPerHeading.get(table.heading) ?? 0) + 1;

    seenPerHeading.set(table.heading, nth);

    out.push({
      ...table,
      key: `${page.rel}#${table.heading}${nth > 1 ? ` (table ${nth})` : ""}`,
    });
  }

  return out;
}

/** First-column headers that mean "this row documents a member of a type". */
const MEMBER_TABLE_HEADERS = new Set(["prop", "field", "option", "method"]);

function memberTables(page: DocsPage): DocsTable[] {
  return tablesOfKind(page, (first) => MEMBER_TABLE_HEADERS.has(first));
}

/**
 * "this row documents a CSS custom property". A separate detector, because
 * {@link MEMBER_TABLE_HEADERS} not covering `Token` is exactly why the token
 * reference drifted for eleven tokens without a single test noticing.
 */
function tokenTables(page: DocsPage): DocsTable[] {
  return tablesOfKind(page, (first) => first === "token");
}

const ALL_TABLES = PAGES.flatMap(memberTables);

/**
 * The member name(s) a table's first cell documents. Handles the three shapes
 * the docs use: a bare name (`viewportHeight`), a signature
 * (`setSort(columnId, direction): void`), and two related members on one row
 * (`getBodyCellClassName / getBodyCellProps`).
 */
function documentedNames(cell: string): string[] {
  return cell
    .replace(/`/g, "")
    .split("/")
    .map((part) => /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(part.trim())?.[0] ?? "")
    .filter(Boolean);
}

interface TypeRef {
  pkg: string;
  name: string;
}

interface BoundTable {
  /**
   * The type(s) whose members this table documents. More than one when the
   * documented type is an intersection of reported ones — `PretableColumn` is
   * `@pretable/react`'s three render fields over `@pretable/core`'s base, and
   * API Extractor reports the base under a rename (`PretableColumn_2`) that is
   * not itself an export.
   */
  types: readonly TypeRef[];
  /**
   * `true` when the table (together with any sibling bound to the same types)
   * is meant to document EVERY member. Omissions then fail — which is the
   * whole point for a props table a reader treats as the complete list.
   */
  complete: boolean;
  /** Required when `complete` is false: why an incomplete table is legitimate. */
  partialReason?: string;
}

interface UnboundTable {
  /** Why this table documents no single reported type. */
  unbound: string;
}

type TableBinding = BoundTable | UnboundTable;

function isBound(binding: TableBinding): binding is BoundTable {
  return "types" in binding;
}

const PRETABLE_COLUMN: readonly TypeRef[] = [
  { pkg: "react", name: "PretableColumn" },
  { pkg: "core", name: "PretableColumn" },
];

/**
 * Why a table documents only some of its type's members. Most narrative pages
 * legitimately cover one slice; `grid/api-reference.mdx` and
 * `grid/pretable-surface.mdx` are the pages that owe the complete list, and
 * those are the ones bound `complete: true`.
 */
const SLICE_OF = (type: string, owner: string): string =>
  `Documents one slice of ${type} in narrative context; ${owner} owns the complete list.`;

/**
 * Every member table in the docs, and what it documents. The roster test below
 * fails if this map and the docs disagree in either direction, so a new table
 * cannot slip in unbound and a deleted one cannot leave a stale entry.
 */
const TABLES: Record<string, TableBinding> = {
  "grid/paste.mdx#The payload": {
    types: [{ pkg: "react", name: "PastePayload" }],
    complete: true,
  },
  "grid/paste.mdx#The payload (table 2)": {
    types: [{ pkg: "react", name: "PastedCell" }],
    complete: true,
  },
  "grid/clipboard.mdx#Building your own serializer": {
    types: [{ pkg: "react", name: "SerializeRangesArgs" }],
    complete: true,
  },

  // Narrative pages: one slice each, checked for existence and optionality.
  "grid/filtering.mdx#Column config": {
    types: PRETABLE_COLUMN,
    complete: false,
    partialReason: SLICE_OF("PretableColumn", "grid/api-reference.mdx"),
  },
  "grid/editing.mdx#Custom editors": {
    types: [{ pkg: "react", name: "PretableEditorInput" }],
    complete: false,
    partialReason: SLICE_OF(
      "PretableEditorInput",
      "grid/api-reference.mdx's type signatures",
    ),
  },

  // Tables that document no reported type.
  "grid/cell-renderers.mdx#Memoization contract": {
    unbound:
      "Mixes PretableCellRenderInput fields with `renderRef` / `fallbackRenderRef`, which are internal memo bookkeeping and not part of any exported type.",
  },
  "grid/editing.mdx#The controlled model": {
    unbound:
      "Documents the anonymous payload object of `PretableSurfaceProps.onCellEdit`, which is declared inline and has no exported name.",
  },
  "headless/state-model.mdx#Row-model state": {
    unbound:
      "Summarizes nested row-model state and snapshot paths rather than the direct members of one exported interface.",
  },
  "grid/keyboard.mdx#Doing this yourself with usePretable": {
    unbound:
      "A reading list of render-snapshot fields, including nested paths like `columns[].left`, rather than the members of one type.",
  },
};

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

/** The presence list every theme is held to — the token contract itself. */
const CONTRACT_TEST = path.join(
  REPO_ROOT,
  "packages/ui/src/__tests__/contract.test.ts",
);

const THEMES_DIR = path.join(REPO_ROOT, "packages/ui/src/themes");

/** The page that owes the reader the complete `--pretable-*` surface. */
const TOKEN_REFERENCE = "theming/token-reference.mdx";

/** Any `--pretable-*` name, wherever it appears — table cell or prose. */
const TOKEN_RE = /--pretable-[a-z0-9-]+/g;

/**
 * A theme stylesheet inside `@pretable/ui`, wherever it appears — an `@import`
 * in a CSS block, an `import` in a TS snippet, a backticked mention in prose.
 *
 * Anchored on the package specifier on purpose. The docs also teach authoring
 * your own theme, and `theming/custom-themes.mdx` names `themes/brand.css` in
 * both prose and a fenced block — a file that is SUPPOSED not to exist here.
 * The specifier is what separates the reader's theme from ours, and it does it
 * without a hand-maintained list of pages to skip. It also loses nothing a
 * reader can paste: an import that resolves always carries it.
 */
const THEME_IMPORT_RE = /@pretable\/ui\/themes\/([a-z0-9-]+\.css)/g;

/**
 * The `TOKENS` array out of the contract test. Entries there are written
 * without the leading `--` (`"pretable-bg-grid"`); this returns them with it,
 * the form the docs and the stylesheets both use.
 *
 * Every failure mode throws. An empty expected set would make the check below
 * vacuously green — which is the same silence that let the token reference sit
 * eleven tokens behind — so "the regex found nothing" is a louder failure than
 * any drift it could have reported.
 */
function parseContractTokens(): Set<string> {
  const rel = path.relative(REPO_ROOT, CONTRACT_TEST);
  let raw: string;

  try {
    raw = fs.readFileSync(CONTRACT_TEST, "utf8");
  } catch {
    throw new Error(
      `Cannot read the token contract at ${rel}. It is the source of truth for ` +
        `${TOKEN_REFERENCE}; if it moved, re-point this test at its new home.`,
    );
  }

  const block = /const TOKENS\s*=\s*\[([\s\S]*?)\]/.exec(raw);

  if (!block) {
    throw new Error(
      `No \`const TOKENS = [...]\` in ${rel} — the contract was restructured ` +
        "and this check can no longer see it. Re-point it; do not delete it.",
    );
  }

  const names = [...(block[1] as string).matchAll(/"([^"]+)"/g)].map(
    (match) => `--${(match[1] as string).replace(/^--/, "")}`,
  );

  if (names.length === 0) {
    throw new Error(
      `Parsed \`TOKENS\` in ${rel} to zero entries. The list is not empty, so ` +
        "the parse is broken and the token checks below are checking nothing.",
    );
  }

  return new Set(names);
}

let contractTokenCache: Set<string> | undefined;

function contractTokens(): Set<string> {
  contractTokenCache ??= parseContractTokens();

  return contractTokenCache;
}

/**
 * A theme's `--pretable-*` declarations, from its `:root` block only. The
 * density tiers and `[data-theme="dark"]` are other columns' worth of data and
 * are not in this page's tables; reading them would compare a dark value
 * against a light one and call the docs wrong.
 */
function parseThemeRoot(file: string): Map<string, string> {
  const full = path.join(THEMES_DIR, file);
  const rel = path.relative(REPO_ROOT, full);
  let raw: string;

  try {
    raw = fs.readFileSync(full, "utf8");
  } catch {
    throw new Error(
      `The token reference has a column for "${file}", but there is no theme ` +
        `at ${rel}. Rename the column, or point it at a theme that exists.`,
    );
  }

  // Comments first: excel.css's file header contains a `:root { … }` override
  // recipe, and several declarations name other tokens in a trailing comment.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const open = /(?:^|\})\s*:root\s*\{/.exec(css);

  if (!open) {
    throw new Error(`${rel} has no top-level \`:root\` block to read.`);
  }

  const start = open.index + open[0].length;
  let depth = 1;
  let end = start;

  while (end < css.length && depth > 0) {
    const char = css[end];

    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;

    end += 1;
  }

  const body = css.slice(start, end - 1);
  const declarations = new Map<string, string>();

  for (const match of body.matchAll(
    /(--pretable-[a-z0-9-]+)\s*:\s*([^;]+);/g,
  )) {
    // Multi-line values (color-mix, font stacks) collapse to one line.
    declarations.set(
      match[1] as string,
      (match[2] as string).replace(/\s+/g, " ").trim(),
    );
  }

  if (declarations.size === 0) {
    throw new Error(
      `Parsed ${rel}'s \`:root\` to zero --pretable-* declarations — the theme ` +
        "layout changed and the value check is comparing nothing.",
    );
  }

  return declarations;
}

const themeRootCache = new Map<string, Map<string, string>>();

function themeRoot(file: string): Map<string, string> {
  let cached = themeRootCache.get(file);

  if (!cached) {
    cached = parseThemeRoot(file);
    themeRootCache.set(file, cached);
  }

  return cached;
}

/**
 * Value-column header → the theme file it claims to show. Matched on the
 * header's leading word, so "Material 3 (light)" and "Material 3 (standard)"
 * both resolve to material.css: both mean that theme's `:root`, which is what
 * {@link parseThemeRoot} reads.
 */
const THEME_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["excel", "excel.css"],
  ["material", "material.css"],
  ["pretable", "pretable.css"],
];

function themeFileFor(header: string): string | undefined {
  const lower = header.toLowerCase();

  // Only `:root` is parsed, so a dark-mode column would be measured against the
  // light values and report every row as stale. Skip it rather than lie.
  if (lower.includes("dark")) return undefined;

  return THEME_COLUMNS.find(([prefix]) => lower.startsWith(prefix))?.[1];
}

/**
 * Values the literal check is willing to compare: a hex colour, a px/rem/em
 * length, a plain number. Deliberately narrow. `rgba(…)` re-spaces and
 * re-rounds between prose and stylesheet (`0.10` vs `0.1`), `var(…)` and
 * `color-mix(…)` are indirections a table may reasonably print either verbatim
 * or resolved, and a font stack wraps. Each of those is a way to fail on a
 * difference that is not drift — and one false failure is all it takes for the
 * next author to decide this check is noise and delete it.
 */
const PLAIN_LITERAL_RE = /^(?:#[0-9a-f]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em)?)$/i;

/** The first backticked span in a cell: its token name, or its value. */
function backticked(cell: string): string | undefined {
  return /`([^`]+)`/.exec(cell)?.[1]?.trim();
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

describe("docs API surface matches the generated API reports", () => {
  test("the docs corpus is non-empty and the reports are readable", () => {
    // Fail closed: every check below is vacuously true over an empty corpus,
    // and a moved content directory or renamed report would silently pass.
    expect(PAGES.length, `no .mdx pages under ${DOCS_ROOT}`).toBeGreaterThan(
      10,
    );
    expect(
      REPORTED_PACKAGES,
      "no packages/*/*.api.md reports found — has the report layout changed?",
    ).toContain("react");

    for (const pkg of REPORTED_PACKAGES) {
      expect(
        report(pkg).exports.size,
        `${pkg}.api.md parsed to zero exports — the report format changed and every check in this file has quietly stopped checking anything`,
      ).toBeGreaterThan(0);
    }
  });

  test("every identifier imported from @pretable/* is a real export", () => {
    const broken: string[] = [];

    for (const page of PAGES) {
      for (const imported of docsImports(page)) {
        const pkgReport = report(imported.pkg);

        if (pkgReport.exports.has(imported.identifier)) continue;

        const internal = `ɵ${imported.identifier}`;
        const hint = pkgReport.exports.has(internal)
          ? `"@pretable/${imported.pkg}" exports it only as \`${internal}\` — the \`ɵ\` prefix means internal, not public API. Do not import it; document the public alternative instead.`
          : `"@pretable/${imported.pkg}" exports no such name.`;

        broken.push(
          `${imported.page}: import { ${imported.identifier} } from "@pretable/${imported.pkg}" — ${hint}`,
        );
      }
    }

    expect(
      broken,
      [
        "A docs code block imports a name the package does not export, so the",
        "snippet is a compile error for anyone who pastes it.",
        "",
        ...broken,
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);
  });

  test("no docs page uses the bare name of a ɵ-internal export", () => {
    const offenders: string[] = [];

    for (const pkg of REPORTED_PACKAGES) {
      for (const name of report(pkg).exports) {
        if (!name.startsWith("ɵ")) continue;

        const bare = name.slice(1);
        const bareRe = new RegExp(`(?<![\\wɵ])${bare}(?![\\w])`, "g");

        for (const page of PAGES) {
          const hits = [...page.raw.matchAll(bareRe)].length;

          if (hits > 0) {
            offenders.push(
              `${page.rel}: ${hits}× \`${bare}\` (@pretable/${pkg} exports it only as \`${name}\`)`,
            );
          }
        }
      }
    }

    expect(
      offenders,
      [
        "A docs page refers to an internal export by its bare name. The `ɵ`",
        "prefix is this repo's marker for 'internal, not public API': the bare",
        "name does not exist on the package, so prose that names it sends the",
        "reader to an import that cannot compile.",
        "",
        ...offenders,
        "",
        "Point the reader at the public alternative instead. If a page genuinely",
        "must name the internal, write it with its `ɵ` prefix — that is the name",
        "that exists.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every member table in the docs is registered in TABLES", () => {
    const found = ALL_TABLES.map((table) => table.key).sort();
    const registered = Object.keys(TABLES).sort();

    expect(
      found,
      [
        "A table documenting the members of a type is not registered in TABLES",
        "in this file (or a registered one no longer exists).",
        "",
        "Hand-maintained member tables have drifted from the code three times.",
        "So the roster is closed: add an entry saying WHICH reported type the",
        "table documents, and the check holds it to that type — names, and",
        "`Required` against the type's optionality.",
        "",
        "If the table documents no single reported type (an ad-hoc summary, a",
        "keyboard map, an un-exported shape), register it as",
        '`{ unbound: "<why>" }`. That is the only escape, and it costs a written',
        "reason. What you may NOT decide here is whether your table gets checked.",
      ].join("\n"),
    ).toEqual(registered);
  });

  test("bound member tables match their type, in both directions", () => {
    const problems: string[] = [];
    /** Documented names per binding group, for the completeness sweep. */
    const documentedByGroup = new Map<string, Set<string>>();
    const groupTables = new Map<string, string[]>();

    for (const table of ALL_TABLES) {
      const binding = TABLES[table.key];

      if (!binding || !isBound(binding)) continue;

      const members = new Map<string, TypeMember>();

      for (const ref of binding.types) {
        const pkgReport = report(ref.pkg);
        const declared = pkgReport.members.get(ref.name);

        if (!declared) {
          problems.push(
            `${table.key}: "${ref.name}" is not an interface in ${ref.pkg}.api.md`,
          );
          continue;
        }

        for (const member of declared) {
          if (!members.has(member.name)) members.set(member.name, member);
        }
      }

      if (members.size === 0) continue;

      const requiredColumn = table.headers.findIndex(
        (header) => header.toLowerCase() === "required",
      );
      const group = JSON.stringify(binding.types);
      const documented = documentedByGroup.get(group) ?? new Set<string>();

      for (const row of table.rows) {
        for (const name of documentedNames(row[0] ?? "")) {
          const member = members.get(name);

          if (!member) {
            problems.push(
              `${table.key}: documents \`${name}\`, which ${binding.types
                .map((ref) => `${ref.name} (@pretable/${ref.pkg})`)
                .join(" / ")} does not have`,
            );
            continue;
          }

          documented.add(name);

          if (requiredColumn >= 0) {
            const claimed = (row[requiredColumn] ?? "").toLowerCase();
            const claimsRequired = claimed === "yes";

            if (claimsRequired === member.optional) {
              problems.push(
                `${table.key}: \`${name}\` is marked Required=${claimed || "(blank)"} but the type declares it ${
                  member.optional ? "optional" : "required"
                }`,
              );
            }
          }
        }
      }

      documentedByGroup.set(group, documented);

      if (binding.complete) {
        groupTables.set(group, [...(groupTables.get(group) ?? []), table.key]);
      }
    }

    for (const [group, tables] of groupTables) {
      const refs = JSON.parse(group) as TypeRef[];
      const documented = documentedByGroup.get(group) ?? new Set<string>();
      const missing: string[] = [];

      for (const ref of refs) {
        for (const member of report(ref.pkg).members.get(ref.name) ?? []) {
          if (!documented.has(member.name)) missing.push(member.name);
        }
      }

      if (missing.length > 0) {
        problems.push(
          `${tables.join(" + ")}: claims to document all of ${refs
            .map((ref) => ref.name)
            .join(" & ")} but omits ${[...new Set(missing)].sort().join(", ")}`,
        );
      }
    }

    expect(
      problems,
      [
        "A docs member table disagrees with the type it documents.",
        "",
        ...problems,
        "",
        "A reader treats these tables as the API. Fix the table.",
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);
  });

  test("the token reference names exactly the tokens the contract ships", () => {
    const page = PAGES.find((candidate) => candidate.rel === TOKEN_REFERENCE);

    if (!page) {
      throw new Error(
        `${TOKEN_REFERENCE} is gone. It is the page that documents the ` +
          "--pretable-* contract; if it was renamed, re-point this check.",
      );
    }

    const shipped = contractTokens();
    const documented = new Set(page.raw.match(TOKEN_RE) ?? []);
    const problems = [
      ...[...shipped]
        .filter((token) => !documented.has(token))
        .map((token) => `${token}: in the contract, absent from the page`),
      ...[...documented]
        .filter((token) => !shipped.has(token))
        .map(
          (token) =>
            `${token}: on the page, absent from the contract (renamed? removed? never public?)`,
        ),
    ];

    expect(
      problems,
      [
        `${TOKEN_REFERENCE} and the token contract disagree about which tokens`,
        "exist. That page is the list of names — a reader who overrides a token",
        "it invented gets silence, and one it omits, they never find.",
        "",
        ...problems,
        "",
        "The contract is packages/ui/src/__tests__/contract.test.ts's TOKENS.",
        "Being in TOKENS is what makes a property public — a theme may declare",
        "others (--pretable-group-indent does) and those are deliberately not",
        "the reader's to override. So the page follows TOKENS, not the",
        "stylesheets, and not the other way round. Fix the page, not this test.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every literal in a token table matches the theme that column names", () => {
    const shipped = contractTokens();
    const tables = PAGES.flatMap(tokenTables);
    const problems: string[] = [];
    let compared = 0;

    expect(
      tables.length,
      `no \`| Token |\` tables found under ${DOCS_ROOT} — the token reference ` +
        "changed shape and this check now reads nothing",
    ).toBeGreaterThan(0);

    for (const table of tables) {
      const columns = table.headers
        .map((header, index) => ({
          header,
          index,
          theme: themeFileFor(header),
        }))
        .filter(
          (
            column,
          ): column is { header: string; index: number; theme: string } =>
            column.theme !== undefined,
        );

      for (const row of table.rows) {
        const token = backticked(row[0] ?? "");

        // A name the contract does not have is the previous check's failure to
        // report; do not say it twice, and do not go looking for its value.
        if (!token || !shipped.has(token)) continue;

        for (const column of columns) {
          const actual = themeRoot(column.theme).get(token);

          if (!actual || !PLAIN_LITERAL_RE.test(actual)) continue;

          const claimed = backticked(row[column.index] ?? "");

          if (!claimed) continue;

          compared += 1;

          if (claimed.toLowerCase() === actual.toLowerCase()) continue;

          problems.push(
            `${token} / ${column.theme} (column "${column.header}"): documented \`${claimed}\`, ships \`${actual}\``,
          );
        }
      }
    }

    expect(
      compared,
      "the token tables yielded almost no comparable literals — either the " +
        "value columns were renamed out of THEME_COLUMNS or PLAIN_LITERAL_RE " +
        "stopped matching, and this check is now decorative",
    ).toBeGreaterThan(20);

    expect(
      problems,
      [
        "A token table prints a value that the theme it names does not ship.",
        "Only plain literals are compared — a var(), color-mix(), rgba() or",
        "font stack is skipped — so every line here is a flat contradiction",
        "between a number in the docs and a number in the stylesheet.",
        "",
        ...problems,
        "",
        "The stylesheet wins: packages/ui/src/themes/<theme>.css at `:root`.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every @pretable/ui theme the docs import is one that ships", () => {
    /** Theme file → the pages importing it, for a message that names them. */
    const referenced = new Map<string, Set<string>>();

    for (const page of PAGES) {
      for (const match of page.raw.matchAll(THEME_IMPORT_RE)) {
        const file = match[1] as string;
        const pages = referenced.get(file) ?? new Set<string>();

        pages.add(page.rel);
        referenced.set(file, pages);
      }
    }

    // Fail closed at both ends. The theme import is the first line the docs
    // teach, and the themes directory is not empty — so "found nothing" on
    // either side means the extraction broke, and every path below would then
    // be checked against nothing (or reported dead en masse).
    expect(
      referenced.size,
      `no @pretable/ui/themes/*.css imports found under ${DOCS_ROOT}. The docs ` +
        "cannot have stopped teaching the theme import, so THEME_IMPORT_RE is " +
        "what changed and this check is now reading an empty corpus",
    ).toBeGreaterThan(0);

    const shipped = new Set(
      fs.readdirSync(THEMES_DIR).filter((name) => name.endsWith(".css")),
    );

    expect(
      shipped.size,
      `no .css files in ${path.relative(REPO_ROOT, THEMES_DIR)} — the themes ` +
        "moved, and every path the docs import would report as dead",
    ).toBeGreaterThan(0);

    const dead = [...referenced]
      .filter(([file]) => !shipped.has(file))
      .map(
        ([file, pages]) =>
          `themes/${file}: imported by ${[...pages].sort().join(", ")}`,
      )
      .sort();

    expect(
      dead,
      [
        "A docs page imports a theme stylesheet @pretable/ui does not ship.",
        "",
        ...dead,
        "",
        `The themes that exist: ${[...shipped].sort().join(", ")}.`,
        "",
        "This is an existence check and nothing more — which theme a page",
        "imports is the author's call, and a page about the Excel skin should",
        "import excel.css. But CSS swallows a dead @import silently: the",
        "reader pastes the snippet, gets an unstyled grid, and is told nothing.",
      ].join("\n"),
    ).toEqual([]);
  });
});
