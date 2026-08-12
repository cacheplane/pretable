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
 *   4. `theming/token-reference.mdx` documented ten fewer than the
 *      `--pretable-*` tokens the themes ship, and still documented
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
 * Ten checks, each aimed at one of the ways the four incidents happened:
 *
 *   - **imports** — every identifier a fenced block imports from `@pretable/*`
 *     must be an export in that package's report. Catches (3) in code.
 *   - **fence visibility** — every `@pretable` import ON a page must be one the
 *     fenced-block extraction actually reached. The import check reads the docs
 *     through a regex, and a block that regex misses is a page checked green
 *     while teaching anything at all. It has happened: the indent allowance sat
 *     one space under what `<Step>` and `<Tab>` nest their children at, and the
 *     install and streaming snippets were both invisible.
 *   - **internal names** — a name the package exports only under the `ɵ`
 *     ("internal, not public API") prefix must not appear anywhere in the docs
 *     under its bare name, prose included. Catches (3) in prose, which the
 *     import check cannot see — and most of (3)'s eleven pages were prose.
 *   - **member tables** — a table documenting a type's members is checked
 *     against that type in the report, both ways: no invented member, no
 *     omitted one, and the optionality column must agree with the type's `?`.
 *     That column is found by the SHAPE of its cells, not by its header, so
 *     renaming `Required` cannot retire it. Catches (1) and (2).
 *   - **the roster** — every member table in the docs must be named in
 *     {@link TABLES}, bound to a type or explicitly excused with a reason.
 *   - **token names** — the token reference must name exactly the tokens in the
 *     {@link CONTRACT_TEST} presence list, both ways: no shipped token left
 *     undocumented, no documented token that no theme defines. Catches (4).
 *   - **token columns** — every `| Token |` table on the reference page must
 *     carry a value column for every theme `@pretable/ui` ships. The expected
 *     set is read out of the themes directory rather than a list in this file,
 *     so a new theme is owed a column in every table, and a renamed header is
 *     a missing column rather than a silent one.
 *   - **token values** — a literal in a per-theme column must equal that
 *     theme's own `:root` declaration; and on the reference page a value cell
 *     may be neither blank nor prose wherever the theme ships a plain literal.
 *     Catches the other half of (4): a rename moves a name, a retheme moves the
 *     values under names that still look right.
 *   - **literal shapes** — the classifier the token-value check reads values
 *     through is pinned against fixtures, both ways. It is an alternation, and
 *     retiring one branch of it (the hex one, say) takes a whole class of
 *     values out of comparison while every other check stays green.
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
 * parse, a shipped theme with no column in a reference-page token table, a
 * reference page that is not where this file says it is, or a docs corpus that
 * appears to import no themes at all is a failure, not a skip.
 *
 * That last rule is written in this file's own blood, twice over.
 *
 * The token-value check went up guarded by a single global floor — "more than
 * 20 literals compared" — over a corpus of about a hundred split across three
 * themes. Every column resolves by its header's LEADING WORD, so renaming
 * `pretable (default)` to `House default` dropped that whole theme's
 * comparisons with no record and the suite stayed green. A column header is
 * editorial prose, and the column that rename switched off was the substantive
 * one: `pretable` is the only theme writing literals rather than `var()`
 * aliases. A check added because a docs table had nothing watching it must not
 * itself be switchable off by a copy edit.
 *
 * The first repair made that floor per theme instead of global — and picked the
 * wrong granularity, because the count still accumulated over the WHOLE docs
 * corpus. It therefore only ever asked "does SOME column SOMEWHERE still
 * compare enough against this theme?", never "does THIS table have a column for
 * every theme?". Renaming the header in nine of the twelve tables left the three
 * largest carrying the floor alone, and the other nine went unwatched — a wrong
 * value planted in one of them included. Worse, the coverage satisfying the
 * floor did not have to live on the protected page at all: a decoy table on a
 * neighbouring page could hold the whole thing up.
 *
 * So the coverage question is now asked per table, and scoped to the page that
 * owes the answer. Every token table on {@link TOKEN_REFERENCE} must carry a
 * column for every theme in {@link THEMES_DIR}, and inside a column that does
 * resolve, every token the theme ships as a plain literal must be printed as
 * one. There is no quota to satisfy and nothing to accumulate against: a
 * renamed header, or a value replaced by prose, fails the table it happened in,
 * one for one.
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

/**
 * A fenced block. Both CommonMark markers open one (` ``` ` and `~~~`), and the
 * closing fence must repeat the marker the opening used (`\1`), so a block
 * quoting the other marker in its body is not cut short.
 *
 * The indent allowance is the load-bearing part, and it was wrong by one space.
 * This was anchored on exactly ` ``` ` in column 0 — which made re-fencing a
 * snippet enough to hide it from every check that reads code — and was widened
 * to the three spaces CommonMark allows a fence in prose. But the docs are MDX,
 * and MDX components nest their children at FOUR: `<Steps>` / `<Step>` and
 * `<Tabs>` / `<Tab>` both do, and a fence indented under one compiles fine.
 *
 * So the two pages a new reader pastes from FIRST —
 * `getting-started/index.mdx`'s install snippet and `streaming/index.mdx`'s two
 * connect snippets — had every one of their `@pretable` imports invisible here.
 * That is incident (3) standing open in the places it costs the most, reopened
 * by exactly the mechanism the widening was meant to close. It was a live
 * hazard too: moving an existing snippet under a `<Step>` is a formatting edit,
 * and it would have retired that page's import check without a word.
 *
 * `{0,15}` is "any nesting a docs component plausibly reaches", not a spec
 * number — the spec's three has no authority inside a JSX container anyway.
 *
 * The closing fence gets the same range rather than a backreference pinning it
 * to the opening indent. An exact-indent close is the stricter rule, but its
 * failure mode is the one being fixed here: a close written at a different
 * indent matches nothing, and the block goes silently missing. A close allowed
 * anywhere in range can instead cut a block short (a body quoting its own
 * marker, indented) — noisier, and watched by `every @pretable import in the
 * docs sits inside a fence this file can see` below.
 */
const FENCE_RE = /^[ \t]{0,15}(```|~~~)[^\n]*\n([\s\S]*?)^[ \t]{0,15}\1/gm;

function fencedBlocks(raw: string): string[] {
  return [...raw.matchAll(FENCE_RE)].map((match) => match[2] as string);
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

/** `import … from "@pretable/…"` statements in a stretch of text. */
function importStatementCount(text: string): number {
  return [...text.matchAll(IMPORT_RE)].length;
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

/**
 * A row's cells, split on unescaped `|` only.
 *
 * A `\|` inside a cell renders as a literal pipe — `boolean \| AutosizeOptions`
 * — and splitting on it shifts every later cell one column left. Forty rows
 * across the corpus carry one, fourteen of them in `grid/pretable-surface.mdx`'s
 * props table, whose `Required` claim was therefore being read out of the middle
 * of a type expression. It read `no` for none of them, and `no` against an
 * optional member agrees, so the check passed by accident on exactly the rows it
 * could not see.
 */
function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/(?<!\\)\|\s*$/, "")
    .split(/(?<!\\)\|/)
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
 * Columns of a member table that read `yes`/`no` on EVERY row — the shape an
 * optionality column has, and the only shape this file can compare against a
 * type's `?`.
 *
 * Located by shape rather than by header text on purpose. The header used to
 * bind it (`findIndex(header === "required")`), which made renaming `Required`
 * to `Req.` a copy edit that silently took all 47 of `pretable-surface.mdx`'s
 * optionality claims out of the check — the same editorial-rename hole the
 * theme columns had, in the table incident (2) was about. The cells are what
 * this check actually reads, so the cells are what binds it.
 *
 * "Every row" and not "every non-empty row": blanking a cell must drop the
 * column and trip the registration check below, not quietly excuse one row.
 */
function optionalityColumns(table: DocsTable): number[] {
  if (table.rows.length === 0) return [];

  const out: number[] = [];

  table.headers.forEach((_header, index) => {
    const cells = table.rows.map((row) =>
      (row[index] ?? "").trim().toLowerCase(),
    );

    if (cells.every((cell) => cell === "yes" || cell === "no")) out.push(index);
  });

  return out;
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

interface DocumentedNames {
  /** Identifiers read out of the cell. */
  names: string[];
  /**
   * Parts of the cell that named no identifier. Never silently dropped — see
   * below.
   */
  unreadable: string[];
}

/**
 * The member name(s) a table's first cell documents. Handles the three shapes
 * the docs use: a bare name (`viewportHeight`), a signature
 * (`setSort(columnId, direction): void`), and two related members on one row
 * (`getBodyCellClassName / getBodyCellProps`).
 *
 * A part that yields no identifier is REPORTED, not skipped. The read is
 * anchored at `^[A-Za-z_$]`, so a first cell of `` [`groupColumn`](#gc) `` or
 * `**groupColumn**` parses to nothing — and a `.filter(Boolean)` here turned
 * that into an empty list, which reads to every check downstream as "this row
 * documents no members" and takes the row out of them entirely. Linkifying a
 * prop name to its own detail section, or bolding it, is an ordinary docs edit.
 *
 * A `complete` table's omission sweep would eventually catch the vanished row,
 * because the member it stopped documenting goes missing. A PARTIAL table has
 * nothing at all watching it — its whole contract is that it documents only
 * some members — and 15 of the 24 bound tables are partial. There the row would
 * simply stop being checked: rename the prop in the code, leave the linkified
 * cell behind, and the docs are wrong with the suite green.
 *
 * So the failure is loud, and the remedy is cheap: lead the cell with the bare
 * name and put the link or the emphasis after it.
 */
function documentedNames(cell: string): DocumentedNames {
  const names: string[] = [];
  const unreadable: string[] = [];

  for (const part of cell.replace(/`/g, "").split("/")) {
    const trimmed = part.trim();
    const name = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(trimmed)?.[0];

    if (name) names.push(name);
    else unreadable.push(trimmed);
  }

  return { names, unreadable };
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

  // The cell presentations. Each interface extends
  // `Omit<HTMLAttributes<HTMLSpanElement>, "children">`, whose angle brackets
  // close on the declaration line, so the report carries exactly the declared
  // members and nothing inherited — which is what makes `complete: true`
  // honest here. The page says in prose that the rest of HTMLAttributes
  // spreads onto the span; that is not a row, because it is not a member.
  "grid/cell-presentations.mdx#PretableDelta": {
    types: [{ pkg: "react", name: "PretableDeltaProps" }],
    complete: true,
  },
  "grid/cell-presentations.mdx#PretableStatus": {
    types: [{ pkg: "react", name: "PretableStatusProps" }],
    complete: true,
  },
  "grid/cell-presentations.mdx#PretableBadge": {
    types: [{ pkg: "react", name: "PretableBadgeProps" }],
    complete: true,
  },
  "grid/cell-presentations.mdx#PretableEntity": {
    types: [{ pkg: "react", name: "PretableEntityProps" }],
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

/**
 * Bound member tables that carry a `yes`/`no` column, and what it means.
 *
 *   - `true` — it is the optionality column. Every row's cell is compared
 *     against the type's own `?`, and the column must keep existing.
 *   - a string — why this table's yes/no column is NOT optionality. The only
 *     way out, and it costs a written reason like every other escape here.
 *
 * Enforced both ways by {@link optionalityColumns}: a registered table that has
 * stopped having such a column fails (renamed header, blanked cell, prose in
 * place of `no`), and a bound table that grows one without saying so fails. The
 * roster is what makes the member tables self-enforcing; without this, the
 * roster bound each TABLE to a type but left its COLUMNS unbound, so `Required`
 * → `Req.` plus a flipped `yes` shipped green.
 */
const MEMBER_TABLE_OPTIONALITY: Record<string, true | string> = {
  // The four cell-presentation tables are the live consumers. Each `Required`
  // cell is held against the interface's own `?`, so documenting `tone` as
  // optional on a status (it is not) or `secondary` as required on an entity
  // (it is not) is a red suite rather than a wrong page.
  "grid/cell-presentations.mdx#PretableDelta": true,
  "grid/cell-presentations.mdx#PretableStatus": true,
  "grid/cell-presentations.mdx#PretableBadge": true,
  "grid/cell-presentations.mdx#PretableEntity": true,

  // This map was EMPTY between the incremental row-model migration (#321) and
  // the cell-presentations page. #321 rewrote the three pages that used to
  // populate it: the props tables on `pretable-component.mdx` and
  // `pretable-surface.mdx` became prose and an `| Area | Props |` summary, and
  // `api-reference.mdx`'s `PretableColumn<TRow>` section became
  // `## Typed columns` around a code block. Those entries were DELETED rather
  // than re-pointed, because the tables they named no longer existed at all —
  // which is what the stale-key check below told us to do the first time it
  // ran against the rewritten pages. Do the same the next time a page is
  // rewritten out from under an entry here: a re-pointed entry that lands on a
  // different table is standing permission for whatever that table claims.
  //
  // Both directions are enforced. A registered table that stops carrying a
  // yes/no column fails (renamed header, blanked cell, prose in place of
  // `no`), and a bound table that grows one without saying so fails too.
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

/**
 * {@link TOKEN_REFERENCE}, or a failure. Every token check is scoped to this
 * one page, so a lookup that quietly returns `undefined` turns each of them
 * vacuous — which is the exact failure mode the whole file exists to prevent.
 * Throwing is the only correct response to "the page this test protects is not
 * where it says it is".
 */
function tokenReferencePage(): DocsPage {
  const page = PAGES.find((candidate) => candidate.rel === TOKEN_REFERENCE);

  if (!page) {
    throw new Error(
      `${TOKEN_REFERENCE} is gone. It is the page that documents the ` +
        "--pretable-* contract; if it was renamed, re-point this check.",
    );
  }

  return page;
}

/**
 * Token tables on {@link TOKEN_REFERENCE} that legitimately carry no per-theme
 * value columns, and why. Empty, and it should stay that way — the page's job
 * is to print each theme's value for each token.
 *
 * This is the single escape hatch from the coverage check below, and it is
 * deliberately the only one. A rule with no way out is a rule the next author
 * deletes the first time it is inconvenient; a rule whose way out costs a
 * written reason and a code review is one they use correctly. What an author
 * must NOT be able to do is switch the check off with a copy edit to a column
 * header, which is precisely how it failed before.
 *
 * Enforced both ways: an entry for a table that no longer exists, or for one
 * that has since grown its columns back, fails too. A stale exception is a hole
 * standing open for whatever table next lands on that heading.
 */
const TOKEN_TABLES_WITHOUT_THEME_COLUMNS: Record<string, string> = {};

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
 * The body of every TOP-LEVEL `:root { … }` rule in a stylesheet, in document
 * order.
 *
 * "Every", plural, is the point. This read one — a single `exec` — and a theme
 * is under no obligation to write one. Splitting a hundred-line `:root` into
 * commented sections, one `:root` rule per group of tokens, is a plausible
 * tidy-up, and CSS treats the result as identical. Under a single `exec` every
 * declaration after the first block simply stopped being read, so those tokens
 * could be documented as anything: a value moved into a second block and
 * printed as `99px` stayed green here AND in `packages/ui`'s own
 * `contract.test.ts`, which reads computed style and so cannot see the split at
 * all. No suite in the repo was looking.
 *
 * Merging beats asserting there is exactly one. The assertion would close the
 * hole just as well, but it turns that tidy-up — which breaks nothing, changes
 * no rendered value, and would read to any reviewer as pure formatting — into a
 * red suite with no defect behind it. This file's own history says a check that
 * fails on a non-defect is a check the next author deletes. Merging is also
 * what the cascade does: same selector, same specificity, later declaration
 * wins, which is exactly `Map.set` over the blocks in order.
 *
 * Top-level only, by brace depth. A `:root` nested in an `@media` or
 * `@supports` is conditional, like `[data-theme="dark"]` and the density tiers,
 * and those are other columns' worth of data that this page's tables do not
 * carry — reading them would compare a dark value against a light one and call
 * the docs wrong.
 */
function topLevelRootBodies(css: string): string[] {
  const depthBefore = new Int32Array(css.length + 1);
  let depth = 0;

  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];

    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;

    depthBefore[i + 1] = depth;
  }

  const bodies: string[] = [];

  // `(?:^|[};])` keeps this to a selector that STARTS a rule, so `.x:root {`
  // is not mistaken for one; the depth test is what makes "top-level" exact.
  for (const open of css.matchAll(/(?:^|[};])\s*:root\s*\{/g)) {
    const at = (open.index as number) + (open[0] as string).indexOf(":root");

    if (depthBefore[at] !== 0) continue;

    const start = (open.index as number) + (open[0] as string).length;
    let nesting = 1;
    let end = start;

    while (end < css.length && nesting > 0) {
      const char = css[end];

      if (char === "{") nesting += 1;
      else if (char === "}") nesting -= 1;

      end += 1;
    }

    bodies.push(css.slice(start, end - 1));
  }

  return bodies;
}

/**
 * A theme's `--pretable-*` declarations, from its top-level `:root` rules —
 * see {@link topLevelRootBodies} for why that is a plural.
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
  const bodies = topLevelRootBodies(css);

  if (bodies.length === 0) {
    throw new Error(`${rel} has no top-level \`:root\` block to read.`);
  }

  const declarations = new Map<string, string>();

  // Document order, later winning — the cascade's own rule for one selector at
  // one specificity.
  for (const body of bodies) {
    for (const match of body.matchAll(
      /(--pretable-[a-z0-9-]+)\s*:\s*([^;]+);/g,
    )) {
      // Multi-line values (color-mix, font stacks) collapse to one line.
      declarations.set(
        match[1] as string,
        (match[2] as string).replace(/\s+/g, " ").trim(),
      );
    }
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
 *
 * Returning `undefined` drops a column silently, which is why the value check
 * asserts every shipped theme is claimed by some header rather than trusting
 * that the headers still say what this list expects.
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
 *
 * DECLINED, deliberately: skipping `color-mix()` means wrapping a declaration in
 * `color-mix(in srgb, <the same colour> 100%, transparent)` — a no-op the
 * renderer cannot tell from the original — takes that token's cell out of the
 * comparison with no visual change. That is not a hole to close, it is the
 * design working: the narrowness is what buys the check its zero false-failure
 * rate, and the attack needs someone to deliberately obfuscate a stylesheet in a
 * way no reviewer would read as innocent. Widening the shape to chase it would
 * trade a hypothetical bad actor for real false failures on `0.10` vs `0.1`,
 * which is the trade that gets this whole check deleted.
 *
 * What DOES need guarding is the shape's integrity: it is an alternation, so a
 * mutation can retire one branch and leave the other carrying the per-theme
 * floor. `hexes and lengths are still comparable` below pins both.
 */
const PLAIN_LITERAL_RE = /^(?:#[0-9a-f]{3,8}|-?\d+(?:\.\d+)?(?:px|rem|em)?)$/i;

/** The first backticked span in a cell — the shape every value cell writes. */
function backticked(cell: string): string | undefined {
  return /`([^`]+)`/.exec(cell)?.[1]?.trim();
}

/** {@link TOKEN_RE} without `g`, for reading one name out of a table cell. */
const TOKEN_IN_CELL_RE = new RegExp(TOKEN_RE.source);

/**
 * The value a table cell claims, if it claims one this check can read.
 *
 * The first backticked span is the shape every value cell uses today, and it
 * is returned verbatim — including a `var(…)` or `color-mix(…)`, because a
 * table printing an indirection where the theme ships a literal is itself
 * drift worth reporting.
 *
 * A cell with no backticks falls back to its bare text, cut at the first `(`
 * so that a trailing annotation (`#fcfcfc (N99)`, `12px (M3 medium shape)`)
 * does not defeat the read, and taken only if what remains is a plain literal.
 * Backticks are formatting; without this fallback, dropping them off a wrong
 * value quietly removed the row from the check.
 *
 * A cell that reduces to neither returns `undefined` — prose like "same as
 * Excel". Comparing that to a hex string would be a guaranteed false failure,
 * and one false failure is all it takes for the next author to decide this
 * check is noise. So `undefined` means "not comparable", never "fine": what
 * the CALLER does with it is where the judgement lives, and on
 * {@link TOKEN_REFERENCE} an uncomparable cell over a theme that ships a plain
 * literal is itself the defect. Returning `undefined` used to be free there,
 * watched only by a floor counting comparisons across the whole corpus — which
 * a column's worth of cells could go missing under, one cell at a time.
 */
function documentedLiteral(cell: string): string | undefined {
  const inTicks = backticked(cell);

  if (inTicks) return inTicks;

  const bare = (cell.replace(/`/g, "").split("(")[0] ?? "").trim();

  return PLAIN_LITERAL_RE.test(bare) ? bare : undefined;
}

interface ThemeColumn {
  header: string;
  index: number;
  theme: string;
}

/**
 * The value columns of one token table, each bound to the theme its header
 * names. Kept as a function of a single table on purpose: the question worth
 * asking is "does THIS table show every theme", and any answer accumulated
 * across tables cannot ask it.
 *
 * EVERY column whose header resolves is returned, including two that resolve to
 * the same theme. A table may legitimately show one theme twice — a light
 * column and a standard-density one — and both mean that theme's `:root`, which
 * is exactly what makes holding both to it correct rather than merely safe.
 *
 * Keeping only the leftmost per theme was a hole with the same shape as every
 * other one in this file's history: the only column ever read for a theme was
 * whichever came first, so inserting a decoy `pretable (light)` column to the
 * left of the real one — correct values, no reader would look twice — took the
 * real column out of the check entirely, and seven wrong values under it shipped
 * green.
 */
function resolvedThemeColumns(table: DocsTable): ThemeColumn[] {
  const out: ThemeColumn[] = [];

  table.headers.forEach((header, index) => {
    const theme = themeFileFor(header);

    if (theme) out.push({ header, index, theme });
  });

  return out;
}

/**
 * The theme stylesheets `@pretable/ui` actually ships.
 *
 * DECLINED, deliberately: this does not recurse, so a theme at
 * `themes/nord/nord.css` is owed no column here and goes undocumented silently.
 * A recursive scan would not fix that, because such a file is not a shipped
 * theme in the first place — `packages/ui/package.json` names every importable
 * stylesheet one by one under `exports`, so `@pretable/ui/themes/nord/nord.css`
 * resolves to nothing for a reader, and {@link THEME_IMPORT_RE} does not match a
 * nested path either. Both sides of this file already agree on flat paths, and
 * agreeing with the export map is the property that matters.
 *
 * If nested themes ever ship, read `exports` rather than deepening this walk:
 * the export map is what a reader can actually import, and a directory walk that
 * disagrees with it would start owing columns to files nobody can load.
 */
function shippedThemeFiles(): string[] {
  return fs
    .readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();
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
    const imports = PAGES.flatMap(docsImports);

    // Fail closed, exactly as the theme-import check does. This check is the
    // one incident (3) is named after, and it reads the docs through two
    // regexes — FENCE_RE then IMPORT_RE. Break either and it reports nothing
    // and passes, which is the shape of silence the incident shipped under.
    expect(
      imports.length,
      `no \`import … from "@pretable/*"\` in any fenced block under ${DOCS_ROOT}. ` +
        "Nearly every page teaches that import, so the docs cannot have stopped " +
        "containing one: FENCE_RE or IMPORT_RE is what changed, and this check " +
        "is now reading an empty corpus.",
    ).toBeGreaterThan(0);

    for (const imported of imports) {
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

  test("every @pretable import in the docs sits inside a fence this file can see", () => {
    // The import check reads the docs through FENCE_RE, and a block FENCE_RE
    // misses is a page whose imports are unchecked while every test here stays
    // green. That is not hypothetical: the fence indent allowance was one space
    // short of what `<Step>` and `<Tab>` nest their children at, so the install
    // page and the streaming page — the first two snippets a reader pastes —
    // were both invisible, and planting a bogus import in either left the suite
    // passing. Counting the statements the extraction reached against the
    // statements on the page turns the next such gap into a failure instead of
    // a silence, whatever causes it: a deeper indent, a marker FENCE_RE does
    // not know, a block cut short by a fence quoted in its own body.
    const unreached = PAGES.map((page) => ({
      page,
      onPage: importStatementCount(page.raw),
      inFences: fencedBlocks(page.raw).reduce(
        (total, block) => total + importStatementCount(block),
        0,
      ),
    }))
      .filter((entry) => entry.onPage !== entry.inFences)
      .map(
        (entry) =>
          `${entry.page.rel}: ${entry.onPage} on the page, ${entry.inFences} inside a fence`,
      );

    expect(
      unreached,
      [
        'A page contains an `import … from "@pretable/…"` that the fenced-block',
        "extraction never reached, so nothing checks that the names it imports",
        "exist. Eleven pages once taught an import that could not compile; this",
        "is the check that sees that, and on these pages it is reading nothing.",
        "",
        ...unreached,
        "",
        "Two ways to get here. Either FENCE_RE missed the block — check the",
        "indent (MDX components nest at four spaces and deeper), the marker, and",
        "whether the body quotes its own fence — or the import is written in",
        "prose rather than in a fenced block, where it is equally unchecked. Put",
        "it in a fence, or widen FENCE_RE to reach it.",
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
    /** Bound tables reached, for the staleness sweep over the optionality map. */
    const boundKeys = new Set<string>();
    /** Rows actually held to a type, and cells actually held to its `?`. */
    let namesChecked = 0;
    let optionalityChecked = 0;

    for (const table of ALL_TABLES) {
      const binding = TABLES[table.key];

      if (!binding || !isBound(binding)) continue;

      boundKeys.add(table.key);

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

      // Fail closed rather than skip. `declared` is an empty array — not
      // `undefined` — the moment MEMBER_RE stops matching the report's layout,
      // so a `continue` here turned every bound table into a no-op for free.
      if (members.size === 0) {
        problems.push(
          `${table.key}: ${binding.types
            .map((ref) => `${ref.name} (@pretable/${ref.pkg})`)
            .join(" / ")} parsed to zero members. The interface is in the ` +
            "report, so MEMBER_RE stopped matching its declarations and this " +
            "table is being checked against nothing.",
        );
        continue;
      }

      // The optionality column is bound by cell shape, not by header text —
      // see optionalityColumns — and by the roster, both ways.
      const yesNo = optionalityColumns(table);
      const optionality = MEMBER_TABLE_OPTIONALITY[table.key];
      let requiredColumn = -1;

      if (optionality === true) {
        if (yesNo.length === 0) {
          problems.push(
            `${table.key}: registered in MEMBER_TABLE_OPTIONALITY as carrying an optionality column, but no column reads \`yes\`/\`no\` on every row — headers are [${table.headers.join(
              " | ",
            )}]. A blanked cell, prose in place of \`no\`, or a column that shifted will all do it; whichever it is, the type's optionality is no longer being checked.`,
          );
        } else if (yesNo.length > 1) {
          problems.push(
            `${table.key}: ${yesNo.length} columns read \`yes\`/\`no\` on every row (${yesNo
              .map((index) => `"${table.headers[index] ?? index}"`)
              .join(
                ", ",
              )}), so this file cannot tell which one is optionality. Split the table, or give the other column values that are not yes/no.`,
          );
        } else {
          requiredColumn = yesNo[0] as number;
        }
      } else if (optionality === undefined && yesNo.length > 0) {
        problems.push(
          `${table.key}: column ${yesNo
            .map((index) => `"${table.headers[index] ?? index}"`)
            .join(
              ", ",
            )} reads \`yes\`/\`no\` on every row, but the table is not in MEMBER_TABLE_OPTIONALITY. Register it \`true\` if it documents optionality — the check will then hold it to the type — or with a written reason if it documents something else.`,
        );
      } else if (typeof optionality === "string" && yesNo.length === 0) {
        // The excuse outlived the column it excused. Left standing, it waves
        // through whatever yes/no column lands in this table next — including
        // a real optionality column, which is the case it was written to say
        // this table does not have.
        problems.push(
          `${table.key}: excused in MEMBER_TABLE_OPTIONALITY ("${optionality}"), but the table now has no yes/no column at all. Delete the entry; a stale excuse is standing permission for the next one.`,
        );
      }

      const group = JSON.stringify(binding.types);
      /**
       * The completeness sweep's ledger for this group — and ONLY a `complete`
       * table may write to it.
       *
       * Every bound table used to contribute, which let a partial table pay a
       * complete one's debts: the sweep asks "is every member documented?" of a
       * set both kinds had filled in. `grid/filtering.mdx#Column config` is one
       * slice of `PretableColumn` and `grid/grouping.mdx#Options` one slice of
       * `PretableSurfaceProps`, and between them they were covering seven
       * members — `type`, `options`, `filterable`, `groupColumn`,
       * `hideGroupedColumns`, `aggregateFilteredRows`, `groupsDefaultExpanded` —
       * that could therefore be deleted from `grid/api-reference.mdx` and
       * `grid/pretable-surface.mdx`, the two pages that owe the reader the FULL
       * list, with the suite green. Those are incidents (1) and (2)'s own pages.
       *
       * `undefined` rather than a local set that is discarded at the end: the
       * set here is fetched from the ledger and mutated IN PLACE, so a partial
       * table merely declining to store it back would still have written
       * through to whatever a complete table left there. `grid/api-reference`
       * sorts before `grid/filtering`, so that is exactly what happened to
       * `PretableColumn` — three of the seven survived the obvious repair.
       */
      const documented = binding.complete
        ? (documentedByGroup.get(group) ?? new Set<string>())
        : undefined;

      for (const row of table.rows) {
        const cell = row[0] ?? "";
        const { names, unreadable } = documentedNames(cell);

        for (const part of unreadable) {
          problems.push(
            `${table.key}: the first cell ${JSON.stringify(
              cell,
            )} has a part (${JSON.stringify(
              part,
            )}) that names no identifier, so this row documents nothing and is not checked against ${binding.types
              .map((ref) => ref.name)
              .join(
                " / ",
              )} at all. A link (\`[\`name\`](#anchor)\`) or emphasis (\`**name**\`) around the name will do it. Lead the cell with the bare name and put the link or emphasis after it.`,
          );
        }

        for (const name of names) {
          const member = members.get(name);

          if (!member) {
            problems.push(
              `${table.key}: documents \`${name}\`, which ${binding.types
                .map((ref) => `${ref.name} (@pretable/${ref.pkg})`)
                .join(" / ")} does not have`,
            );
            continue;
          }

          documented?.add(name);
          namesChecked += 1;

          if (requiredColumn >= 0) {
            const claimed = (row[requiredColumn] ?? "").toLowerCase();
            const claimsRequired = claimed === "yes";

            optionalityChecked += 1;

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

      if (documented) {
        documentedByGroup.set(group, documented);
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

    // A stale entry is a claim on a table that is not there: whatever member
    // table next lands on that heading inherits it, and inherits `true`
    // silently if it happens to carry a yes/no column of its own.
    for (const key of Object.keys(MEMBER_TABLE_OPTIONALITY)) {
      if (boundKeys.has(key)) continue;

      problems.push(
        `${key}: in MEMBER_TABLE_OPTIONALITY, but no bound member table has that key (renamed heading? moved page? re-registered as \`unbound\`?). Delete the entry or re-point it.`,
      );
    }

    // Floors, not drift detectors. Everything above reports through `problems`,
    // and an empty `problems` is indistinguishable from "read nothing at all" —
    // which is what breaking MEMBER_RE, FENCE_RE or the table parse produces.
    // The roster test pins WHICH tables exist; these pin that the rows inside
    // them were actually compared to something.
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

    expect(
      namesChecked,
      "not one documented member name was matched against a reported type. " +
        "The roster is non-empty and every bound table lists members, so this " +
        "means the report parse or the table parse stopped seeing them and " +
        "this check is green over nothing.",
    ).toBeGreaterThan(0);

    // Conditional on the roster, not unconditional: an empty roster is a
    // legitimate state (no docs table carries an optionality column today, see
    // MEMBER_TABLE_OPTIONALITY) and must not be a failure, or the only way to
    // get green is to invent a table. What must never happen is a roster that
    // registers tables and still compares nothing — that is the vacuous case.
    if (Object.values(MEMBER_TABLE_OPTIONALITY).some((v) => v === true)) {
      expect(
        optionalityChecked,
        "not one `Required` cell was compared against its type's optionality, " +
          "though MEMBER_TABLE_OPTIONALITY registers tables that carry one. " +
          "Incident (2) was `viewportHeight` and `getRowId` documented with " +
          "their optionality backwards; this is the check that sees that, and " +
          "it just read nothing.",
      ).toBeGreaterThan(0);
    }
  });

  test("the token reference names exactly the tokens the contract ships", () => {
    const page = tokenReferencePage();
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
        "Being in TOKENS is what makes a property public — the reader's to find",
        "here, to read, and to override. A theme is free to declare a private",
        "helper property outside it, and such a property is deliberately not",
        "this page's to document; today no shipped theme has one, so the two",
        "sets coincide. Either way the page follows TOKENS, not the",
        "stylesheets: a name appearing in a theme is not what puts it here.",
        "Fix the page, not this test.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every token table on the reference page shows every shipped theme", () => {
    const tables = tokenTables(tokenReferencePage());
    const themes = shippedThemeFiles();

    // Both sides fail closed. No tables means the page changed shape and this
    // check has nothing to hold; no themes means every table below would be
    // trivially complete.
    expect(
      tables.length,
      `no \`| Token |\` tables on ${TOKEN_REFERENCE} — the page changed shape ` +
        "and this check now reads nothing",
    ).toBeGreaterThan(0);
    expect(
      themes,
      `no .css themes in ${path.relative(REPO_ROOT, THEMES_DIR)} — the themes ` +
        "moved, and every table would pass with no columns at all",
    ).not.toEqual([]);

    const gaps: string[] = [];
    const excused = new Set(Object.keys(TOKEN_TABLES_WITHOUT_THEME_COLUMNS));
    const matched = new Set<string>();

    for (const table of tables) {
      const resolved = new Map<string, string[]>();

      for (const column of resolvedThemeColumns(table)) {
        resolved.set(column.theme, [
          ...(resolved.get(column.theme) ?? []),
          column.header,
        ]);
      }

      const missing = themes.filter((file) => !resolved.has(file));

      if (excused.has(table.key)) {
        matched.add(table.key);

        if (missing.length === 0) {
          gaps.push(
            `${table.key}: excused in TOKEN_TABLES_WITHOUT_THEME_COLUMNS, but it now shows every theme — delete the entry so the table is checked like the rest.`,
          );
        }

        continue;
      }

      if (missing.length === 0) continue;

      gaps.push(
        `${table.key}: no column for ${missing
          .map((file) => `themes/${file}`)
          .join(
            ", ",
          )} — headers are [${table.headers.join(" | ")}], which resolve to ${
          [...resolved]
            .map(
              ([file, headers]) =>
                `${file} ← ${headers.map((header) => `"${header}"`).join(" + ")}`,
            )
            .sort()
            .join(", ") || "no theme at all"
        }`,
      );
    }

    for (const key of [...excused].filter((entry) => !matched.has(entry))) {
      gaps.push(
        `${key}: excused in TOKEN_TABLES_WITHOUT_THEME_COLUMNS, but no such table exists on ${TOKEN_REFERENCE} — a stale exception is a hole held open for whatever table lands on that heading next.`,
      );
    }

    expect(
      gaps,
      [
        `A token table on ${TOKEN_REFERENCE} does not show every theme`,
        "@pretable/ui ships, so the values it prints for the missing theme(s)",
        "are not compared against anything.",
        "",
        ...gaps,
        "",
        "A column is bound to a theme by its header's LEADING WORD, via",
        "THEME_COLUMNS in this file. That makes the binding editorial prose:",
        "renaming `pretable (default)` to `House default` reads like a copy edit",
        "and takes that theme's values out of the check with it. This check is",
        "what turns such a rename back into a code change. Restore the leading",
        "word, or teach THEME_COLUMNS the new one.",
        "",
        "The expected set is read from the themes directory, not from a list",
        "here, so a NEW theme is owed a column in every table on this page. That",
        "is the intent: the token reference is where a reader reads a theme's",
        "values, and a theme with no column is a theme with no documented ones.",
        "",
        "If a file named above is not a theme but a shared partial (`_tokens.css`",
        "and the like), the directory is the thing that is wrong: every `.css`",
        "under themes/ is treated as a shipped theme here AND by the import check",
        "below. Move the partial out rather than teaching this file to skip it —",
        "a skip list here is a place to hide a real theme.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every literal in a token table matches the theme that column names", () => {
    const shipped = contractTokens();
    const tables = PAGES.flatMap(tokenTables);
    const problems: string[] = [];
    /** Theme file → literals its columns actually got to compare. */
    const comparedPerTheme = new Map<string, number>();
    /**
     * Contract tokens a token table ON THE REFERENCE PAGE documents as a row.
     *
     * Page-scoped, because the `untabled` check below asks whether the page
     * that owes the reader the token surface still tables the names it prints.
     * Accumulating this over the whole corpus answered a different question —
     * "does SOME page table it?" — and so let the tables emigrate: move a table
     * to a new page, leave its names in prose here, and the row on the new page
     * satisfied the check while nothing on this page was watched at all. That is
     * the same "coverage held up from somewhere else" hole the per-theme floor
     * had, one level up.
     */
    const tabled = new Set<string>();

    expect(
      tables.length,
      `no \`| Token |\` tables found under ${DOCS_ROOT} — the token reference ` +
        "changed shape and this check now reads nothing",
    ).toBeGreaterThan(0);

    for (const table of tables) {
      const columns = resolvedThemeColumns(table);
      /**
       * Only the reference page owes a printed value for every token. A
       * narrative table elsewhere may legitimately say "same as the header" in
       * prose; what no table anywhere may do is print a literal that is wrong.
       */
      const owesValues = table.page === TOKEN_REFERENCE;

      for (const row of table.rows) {
        // Read the name out of the cell rather than out of its backticks: the
        // backticks are formatting, and a row that lost them must not thereby
        // lose its values' check.
        const token = TOKEN_IN_CELL_RE.exec(row[0] ?? "")?.[0];

        // A name the contract does not have is the previous check's failure to
        // report; do not say it twice, and do not go looking for its value.
        if (!token || !shipped.has(token)) continue;

        if (owesValues) tabled.add(token);

        for (const column of columns) {
          const cell = row[column.index] ?? "";
          const actual = themeRoot(column.theme).get(token);

          // An empty cell is checked before the literal gate below, because a
          // hole in a reference table is a defect whatever the theme ships
          // there — the reader is told nothing and cannot tell it from a
          // token the theme leaves alone.
          if (cell.trim() === "") {
            problems.push(
              `${token} / ${column.theme} (column "${column.header}"): the value cell is empty; the theme ships \`${actual ?? "nothing at :root"}\``,
            );
            continue;
          }

          if (!actual || !PLAIN_LITERAL_RE.test(actual)) continue;

          const claimed = documentedLiteral(cell);

          // The theme ships a plain literal, so there IS a right answer to
          // print. A cell that reduces to neither a literal nor a `var()` —
          // prose like "same as Excel" — removes itself from the comparison,
          // and doing it cell by cell used to be free: the only thing watching
          // was a floor counting comparisons across the whole corpus, so 25 of
          // pretable's 40 could go before anything noticed. On the page whose
          // job is to be the table of values, an uncomparable cell IS the
          // defect, at n=1.
          if (!claimed) {
            if (owesValues) {
              problems.push(
                `${token} / ${column.theme} (column "${column.header}"): the cell reads ${JSON.stringify(
                  cell,
                )}, which names no value; the theme ships the plain literal \`${actual}\``,
              );
            }

            continue;
          }

          comparedPerTheme.set(
            column.theme,
            (comparedPerTheme.get(column.theme) ?? 0) + 1,
          );

          if (claimed.toLowerCase() === actual.toLowerCase()) continue;

          problems.push(
            `${token} / ${column.theme} (column "${column.header}"): documented \`${claimed}\`, ships \`${actual}\``,
          );
        }
      }
    }

    const themes = shippedThemeFiles();

    expect(
      themes,
      `no .css themes in ${path.relative(REPO_ROOT, THEMES_DIR)} — the themes ` +
        "moved, and the per-theme guard below would hold this check to nothing",
    ).not.toEqual([]);

    // A backstop, not a drift detector, and deliberately not a quota. The DOCS
    // can no longer thin a theme's coverage — the table above must show every
    // theme, and a reference-page cell must print whatever the theme ships as a
    // plain literal — so the only remaining route to zero runs through the
    // STYLESHEET: move every documented value behind var() or color-mix(), both
    // skipped by design, and this check would compare nothing while staying
    // green. That is the residue the old corpus-wide floor was reaching for,
    // and one is the only honest number for it: any higher and the figure is a
    // guess about how many literals a theme ought to keep.
    const silent = themes
      .filter((file) => (comparedPerTheme.get(file) ?? 0) === 0)
      .map((file) => `themes/${file}: zero comparable literals in any column`);

    expect(
      silent,
      [
        "A theme's columns resolve, but not one value in them could be compared",
        "against the stylesheet, so this check is decorative for that theme.",
        "",
        ...silent,
        "",
        "Only plain literals are comparable — a var(), color-mix(), rgba() or",
        "font stack is skipped, because each of those can be printed either",
        "verbatim or resolved and neither is drift. If the theme genuinely moved",
        "every documented value behind an indirection, say so here deliberately.",
        "Otherwise PLAIN_LITERAL_RE stopped matching what the theme writes.",
      ].join("\n"),
    ).toEqual([]);

    // A rename in the OTHER direction: `tokenTables` fires on a first header
    // of exactly `Token`, so retitling one table's first column drops all of
    // its rows out of the value check while the name check above stays green
    // — the names are still on the page, just no longer in a table this file
    // can see. Every contract token the page names must be a row ON THIS PAGE:
    // `tabled` is page-scoped, so moving a table to a neighbouring page and
    // leaving its names behind in prose fails here rather than passing on the
    // strength of a row this page's reader will never reach.
    //
    // Read through the throwing lookup, not an optional chain: `?? []` here
    // would make the check vacuously green exactly when the page it protects
    // has gone missing, which is the same shape of silence as everything else
    // in this file's history.
    const untabled = [
      ...new Set(tokenReferencePage().raw.match(TOKEN_RE) ?? []),
    ]
      .filter((token) => shipped.has(token) && !tabled.has(token))
      .sort();

    expect(
      untabled,
      [
        `${TOKEN_REFERENCE} names these tokens, but no \`| Token |\` table ON`,
        "THAT PAGE has a row for them, so nothing checks the values it prints:",
        "",
        ...untabled,
        "",
        "Three ways to get here, and all three leave the page looking complete:",
        "the token lost its row; its table lost the first header (`Token`) that",
        "makes this file recognise it as a token table; or the table moved to",
        "another page and left the name behind in prose. A row elsewhere does",
        "not count — this page is the one that owes the reader the value.",
      ].join("\n"),
    ).toEqual([]);

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

  test("hexes and lengths are still comparable, and indirections still are not", () => {
    // PLAIN_LITERAL_RE is an alternation, and an alternation is a thing you can
    // half-break. Retire only its hex branch and every colour in the token
    // reference silently stops being compared — the per-theme floor above does
    // not notice, because each theme still ships enough px values to clear it,
    // and pretable.css's forty colours were the substantive half of this check.
    // So the shape gets pinned rather than trusted: both branches, both ways.
    const comparable = [
      "#fff",
      "#FCFCFC",
      "#0a0a0aff",
      "0",
      "1",
      "700",
      "12px",
      "-2px",
      "0.5rem",
      "1.5em",
    ];
    const skipped = [
      "",
      "var(--pretable-bg-grid)",
      "color-mix(in srgb, #ffffff 50%, transparent)",
      "rgba(0, 0, 0, 0.1)",
      "0 1px 2px rgba(0, 0, 0, 0.2)",
      "ui-sans-serif, system-ui, sans-serif",
      "same as Excel",
      "#xyz",
      "12pt",
    ];

    expect(
      comparable.filter((value) => !PLAIN_LITERAL_RE.test(value)),
      "PLAIN_LITERAL_RE stopped recognising a value shape the themes ship, so " +
        "every cell printing that shape is now skipped instead of compared — " +
        "silently, and while the check still reports green.",
    ).toEqual([]);

    expect(
      skipped.filter((value) => PLAIN_LITERAL_RE.test(value)),
      "PLAIN_LITERAL_RE started matching an indirection or a multi-part value. " +
        "Those are skipped on purpose: a var() or color-mix() may be printed " +
        "either verbatim or resolved and neither is drift, and rgba() re-rounds " +
        "between prose and stylesheet. Matching them buys false failures, which " +
        "is how a check like this gets deleted.",
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

    const shipped = new Set(shippedThemeFiles());

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

  test("no docs page names a custom property from the retired --pt-color-* namespace", () => {
    // The grid controls moved out of `--pt-color-*` into the documented
    // `--pretable-*` contract, and packages/ui's contract.test.ts has asserted
    // since then that grid.css references none of the old names. Nothing made
    // the same assertion about the docs, and two lines on the selection page
    // went on naming four retired checkbox properties and a retired focus-ring
    // one — an override a reader could copy, paste, and watch do nothing,
    // because an unknown custom property is not an error in CSS, just silence.
    //
    // Deliberately the whole corpus and both prose and fences: the token
    // reference's own name check reads one page, and the stale names were on a
    // grid page, in prose. This is a NAMESPACE check, not a spelling one —
    // every retired name shares the prefix, so the prefix is the thing to ban.
    const offenders = PAGES.flatMap((page) => {
      const hits = new Set(page.raw.match(/--pt-color-[a-z0-9-]+/g) ?? []);
      return hits.size === 0
        ? []
        : [`${page.rel}: ${[...hits].sort().join(", ")}`];
    }).sort();

    expect(
      offenders,
      [
        "A docs page documents a custom property in the retired --pt-color-*",
        "namespace. Those properties are read by nothing: a reader who sets one",
        "gets no error and no effect.",
        "",
        ...offenders,
        "",
        "The replacements are the --pretable-* tokens on",
        `${TOKEN_REFERENCE}. If a property genuinely has no --pretable-*`,
        "equivalent, it is not documentable — cut the sentence.",
      ].join("\n"),
    ).toEqual([]);
  });
});
