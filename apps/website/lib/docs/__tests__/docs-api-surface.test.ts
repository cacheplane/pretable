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
 * Three more ways were found by audit rather than by an incident, and are
 * closed here. Each had shipped green for as long as it existed:
 *
 *   5. A table enumerating a DISCRIMINATED UNION — `headless/state-model.mdx`'s
 *      `status.kind` — was checked by nothing, for two independent reasons and
 *      either would have done it alone. The alias reader stopped at the first
 *      `;`, which for `{ readonly kind: "ready"; }` lands four characters into
 *      the body, so an object union was never captured at all; and the member
 *      table detector fires on a first header of `prop`/`field`/`option`/
 *      `method`, and that table leads with `` `status.kind` ``. Same shape as
 *      (4): a table nobody registered, in a page whose job is to be the list.
 *   6. The compile-time fixtures under `app/docs/__tests__/*.types.tsx` are
 *      hand transcriptions of code fences, and nothing tied a fixture to the
 *      fence it transcribes. They proved that THEIR code compiles; rewording,
 *      re-fencing or deleting a snippet left them compiling code no page shows.
 *   7. The `Type` column of a props table was read by nothing. `complete: true`
 *      pinned the set of member NAMES and their `?` — so retyping
 *      `PretableDeltaProps.value` from `number` to `string` was green, in a
 *      cell a reader writes their own signature against.
 *
 * Eighteen checks, each aimed at one of the ways those seven happened:
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
 *     {@link TABLES}, bound to a type or explicitly excused with a reason. A
 *     table documenting an inline object type — `PretableTelemetry.windowGap`,
 *     which the report spells out in full under no name of its own — binds
 *     through {@link TypeRef}'s `member` rather than taking the excuse: the
 *     shape is in the report, so "no exported name" is not a reason nobody can
 *     check it.
 *   - **type cells** — a member table's `Type` column is held to the member's
 *     DECLARED type. Whitespace, the `\|` a cell must escape, and the
 *     `| undefined` an optional member's `?` already implies are normalised
 *     away; a docs cell that expands a string-literal alias to the values it
 *     stands for is held to the union instead of excused, because that cell is
 *     the only place some unions are listed at all. Everything else that
 *     legitimately differs — a bound type argument, an inline object printed by
 *     its field names — is a row in {@link TYPE_CELL_EXCEPTIONS} with a written
 *     reason, and an exception whose row starts matching fails as stale.
 *     Catches (7).
 *   - **fence fixtures** — every `*.types.tsx` fixture names, in the file
 *     itself, which fence each of its regions transcribes; every fence on a
 *     page some fixture transcribes is claimed by exactly one region or excused
 *     in {@link UNTRANSCRIBED_FENCES}; and the fixture set on disk is the one
 *     {@link FIXTURE_FILES} names, so deleting a fixture cannot quietly delete
 *     its page's coverage. Catches (6)'s registration half.
 *   - **fence reproduction** — a fence's tokens must appear, in order, inside
 *     the fixture region that claims it. Tokens rather than text, because both
 *     sides are prettier's output at different widths; a region rather than the
 *     whole file, because a token borrowed from three declarations away would
 *     cover a snippet that had been reworded. Catches (6).
 *   - **union tables** — a table whose first column is a union's DISCRIMINANT
 *     is held to that union both ways: no invented `kind`, none omitted, and
 *     each alternative's other members must be exactly what the table's
 *     carried-fields column lists. That column is found by the SHAPE of its
 *     cells, like the optionality one. Catches (5).
 *   - **union table roster** — every discriminant table in the corpus must be
 *     in {@link DISCRIMINANT_TABLES}, bound or excused, and the expected key
 *     set is computed from the docs — so a decoy table on a neighbouring page
 *     cannot sit there looking right while the real one drifts.
 *   - **union prose** — a string-literal union's members cannot be a table: a
 *     props table prints only its NAME, so the members are spelled out as a
 *     sentence, and prose is what the table checks cannot see. A sentence
 *     enumerating a union is held to the union both ways. Registered on the
 *     same terms as the tables: every union the docs NAME must be in
 *     {@link STRING_UNIONS}, bound to the page that spells it out or excused
 *     with a reason, and an excuse that acquires a sentence fails.
 *   - **union roster** — the expected key set is computed from the reports, so
 *     naming a new union in the docs forces an entry rather than a silence.
 *   - **message-key listings** — the tool-panel page's strings paragraphs are
 *     prose lists of `messages` keys, and prose is what none of the table
 *     checks can see: deleting `toolPanelExpandAllLabel` from the grouping
 *     section's listing left the whole suite green (proven by mutation, not by
 *     incident — for once). Every `toolPanel*` key the react report declares
 *     is in {@link TOOL_PANEL_MESSAGE_KEYS}, bound to the section whose
 *     listing must name it — or ride the covering phrase it names it through,
 *     or be excused with a reason — and the roster's expected key set is
 *     computed from the report, so a new key forces an entry rather than a
 *     silence.
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
  /**
   * The declared type text, whitespace-collapsed: `number`,
   * `PretableStatusTone`, `(direction?: PretableFocusDirection) => void`.
   *
   * This is what a props table's `Type` column claims, and until it was read
   * here nothing checked that claim: `complete: true` pinned the set of member
   * NAMES and their `?`, so retyping `PretableDeltaProps.value`'s cell from
   * `number` to `string` was green. A reader takes that column literally —
   * it is what they write their handler's signature against.
   *
   * A method declaration (`cancel(): void`) is stored in the arrow form a docs
   * table writes it as (`() => void`). The two say the same thing about the
   * call, and normalising here is what keeps a correct row from failing.
   */
  type: string;
}

/** One alternative of a discriminated object union. */
interface UnionAlternative {
  /** The discriminant's literal value — `"rebuilding"` → `rebuilding`. */
  kind: string;
  /** Every OTHER member the alternative declares, in declaration order. */
  carries: string[];
}

interface DiscriminatedUnion {
  /** The member every alternative pins to a distinct literal — `kind`. */
  discriminant: string;
  alternatives: UnionAlternative[];
}

interface ApiReport {
  pkg: string;
  /** Every exported name, `ɵ`-prefixed ones included. */
  exports: Set<string>;
  /** Members of each exported `interface`, by interface name. */
  members: Map<string, TypeMember[]>;
  /**
   * Members of each exported STRING-LITERAL union, by type name, in
   * declaration order — `PretableBadgeTone` → `["positive", …]`. Only unions
   * whose every alternative is a quoted literal are collected: those are the
   * ones the docs spell out as a sentence, and the only ones a sentence can be
   * compared against.
   */
  unions: Map<string, string[]>;
  /**
   * Each exported DISCRIMINATED OBJECT union, by type name — every alternative
   * an object type, all of them pinning one shared member to a distinct
   * literal.
   *
   * These are the unions the docs draw as a TABLE rather than spell out as a
   * sentence, one row per `kind`, and nothing here could see either half of
   * that table. Two independent reasons, and each was enough on its own:
   * {@link stringUnionMembers} returns `undefined` unless every alternative is
   * a quoted literal, and the alias reader stopped at the first `;` — which,
   * for `{ readonly kind: "ready"; }`, lands inside the first brace, so an
   * object union's body was never captured to begin with.
   */
  discriminatedUnions: Map<string, DiscriminatedUnion>;
}

const EXPORT_RE =
  /^export (?:declare )?(?:abstract )?(?:async )?(?:function|const|let|var|class|interface|type|enum|namespace)\s+([^\s(<:={;]+)/gm;

/**
 * A member declaration at the interface's own indent level. Anchored at exactly
 * four spaces so that members of a nested object literal (eight spaces) and the
 * report's `// (undocumented)` / `// Warning:` comment lines are both skipped.
 *
 * The separator is captured because it says which SHAPE the declaration is: a
 * `:` introduces a type, a `(` opens a method's parameter list, and the two are
 * read differently by {@link declaredTypeText}.
 */
const MEMBER_RE = /^ {4}(?:readonly )?([A-Za-z_$][A-Za-z0-9_$]*)(\?)?\s*([:(])/;

const OPENERS = "{([";
const CLOSERS = "})]";

/**
 * The text from `lines[startLine][startColumn]` up to the `;` that ends the
 * declaration, whitespace-collapsed.
 *
 * Depth-aware over `{}`, `()` and `[]`, because a declaration's own body is
 * full of `;`: `clipped: { rows: number; columns: number; }` ends at the fourth
 * one, not the first. Angle brackets are deliberately NOT tracked — `=>` would
 * decrement a depth counter that `<` never incremented, and no `;` hides inside
 * a type argument anyway.
 *
 * Line comments are cut at `//`. API Extractor puts `// (undocumented)` on its
 * own line between members, but a trailing one on a wrapped declaration would
 * otherwise be read as part of the type.
 */
function readDeclarationText(
  lines: string[],
  startLine: number,
  startColumn: number,
): string {
  const parts: string[] = [];
  let depth = 0;

  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const from = i === startLine ? startColumn : 0;
    let cut = line.length;

    for (let c = from; c < line.length; c += 1) {
      const char = line[c] as string;

      if (char === "/" && line[c + 1] === "/") {
        cut = c;
        break;
      }

      if (OPENERS.includes(char)) depth += 1;
      else if (CLOSERS.includes(char)) depth -= 1;
      else if (char === ";" && depth === 0) {
        parts.push(line.slice(from, c));

        return parts.join(" ").replace(/\s+/g, " ").trim();
      }
    }

    parts.push(line.slice(from, cut));
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * The declared type of the member {@link MEMBER_RE} just matched.
 *
 * A method (`commit(direction?: PretableFocusDirection): void`) is rewritten to
 * the arrow form the docs write (`(direction?: PretableFocusDirection) => void`)
 * rather than left in declaration form. The two describe the same call, and a
 * docs table has no way to write the declaration form inside a `Type` cell —
 * so leaving it would fail every method row for saying the right thing.
 */
function declaredTypeText(
  lines: string[],
  line: number,
  match: RegExpExecArray,
): string {
  const separator = match[3] as string;
  const head = (match[0] as string).length;

  if (separator === ":") return readDeclarationText(lines, line, head);

  const signature = readDeclarationText(lines, line, head - 1);
  let depth = 0;

  for (let i = 0; i < signature.length; i += 1) {
    const char = signature[i] as string;

    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        const parameters = signature.slice(0, i + 1);
        const returns = signature.slice(i + 1).replace(/^\s*:\s*/, "");

        return `${parameters} => ${returns}`.trim();
      }
    }
  }

  return signature;
}

/**
 * A type body with its TSDoc block comments removed, each replaced by a space so
 * that nothing either side of one is joined into a single token.
 *
 * API Extractor keeps a union's per-alternative TSDoc inside the alias excerpt,
 * so the report writes `PretableDataState` as a comment, then `{ phase: "idle";
 * }`, then a comment, then the next alternative. {@link topLevelAlternatives}
 * splits that correctly — six alternatives, the right ones — but each part then
 * BEGINS with a comment rather than with `{`, so {@link objectTypeMembers}
 * rejects it, {@link discriminatedUnionOf} returns `undefined`, and the union is
 * never captured. That is the same silence as (5): the docs page drew all six
 * phases as a table, and a `DISCRIMINANT_TABLES` entry for it could not even be
 * written, because the union this file could see did not exist.
 *
 * String literals are not tracked. A `/*` inside one would be cut here — but a
 * report is generated, and a string literal type containing an open-comment
 * digraph is not a shape any of these packages declare.
 */
function withoutBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Every exported `type` alias, name → body text, read brace-aware.
 *
 * This replaced `/^export type (\w+)\s*=\s*([^;]*);/gm`, which could see only
 * the aliases whose bodies contain no `;` and no generic parameters. A
 * discriminated union is neither: `PretableRowModelStatus`'s first alternative
 * is `{ readonly kind: "ready"; }`, so the old capture ended four characters
 * into the body and the alias was skipped entirely. It was not a case the
 * union checks declined — it was one they could not see, which is why the
 * `status.kind` table went unwatched without a single roster entry to say so.
 *
 * The `=` is found at angle depth 0 so that a generic default (`<T = string>`)
 * is not mistaken for it, and `=>` inside a parameter default does not close
 * the angle depth it never opened. The body then runs to the `;` at bracket
 * depth 0, exactly as {@link readDeclarationText} reads a member.
 *
 * Block comments are skipped over while looking for that `;`, and then stripped
 * from the captured body by {@link withoutBlockComments}. Both halves are
 * load-bearing, and each hid `PretableDataState` on its own. The scan half is
 * the more insidious: `stale`'s TSDoc reads "answer a PREVIOUS query; the
 * desired one is in flight", and that prose semicolon sits at bracket depth 0
 * between two alternatives — so the alias ended two alternatives in, at a
 * sentence's punctuation. A comment is not code, and neither the terminator nor
 * the alternatives may be decided by what one says.
 */
function typeAliasBodies(raw: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const match of raw.matchAll(
    /^export type ([A-Za-z_$][A-Za-z0-9_$]*)/gm,
  )) {
    let index = (match.index as number) + (match[0] as string).length;
    let angle = 0;
    let assign = -1;

    for (; index < raw.length; index += 1) {
      const char = raw[index] as string;

      if (char === "<") angle += 1;
      else if (char === ">") {
        if (raw[index - 1] !== "=") angle -= 1;
      } else if (char === "=" && angle === 0 && raw[index + 1] !== ">") {
        assign = index;
        break;
      }
    }

    if (assign < 0) continue;

    let depth = 0;
    let end = assign + 1;

    for (; end < raw.length; end += 1) {
      const char = raw[end] as string;

      if (char === "/" && raw[end + 1] === "/") {
        const newline = raw.indexOf("\n", end);

        if (newline < 0) break;

        end = newline;
        continue;
      }

      if (char === "/" && raw[end + 1] === "*") {
        const close = raw.indexOf("*/", end + 2);

        if (close < 0) break;

        end = close + 1;
        continue;
      }

      if (OPENERS.includes(char)) depth += 1;
      else if (CLOSERS.includes(char)) depth -= 1;
      else if (char === ";" && depth === 0) break;
    }

    out.set(
      match[1] as string,
      withoutBlockComments(raw.slice(assign + 1, end)),
    );
  }

  return out;
}

/**
 * A type body split on the `|` alternatives at its own top level. `<` and `>`
 * are counted here — a union alternative may be `Foo<A | B>`, and splitting
 * inside the type argument would invent two alternatives out of one — with the
 * same `=>` exemption {@link typeAliasBodies} uses.
 */
function topLevelAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] as string;

    if (OPENERS.includes(char) || char === "<") depth += 1;
    else if (CLOSERS.includes(char)) depth -= 1;
    else if (char === ">" && body[i - 1] !== "=") depth -= 1;
    else if (char === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * `readonly kind: "ready"` → one entry; `undefined` if anything does not parse.
 *
 * Returns full {@link TypeMember}s rather than name/type pairs because this is
 * also how a table bound to an INLINE object type reads its members — see
 * {@link TypeRef}'s `member`. The union checks below use only `name` and
 * `type`; `optional` is there so an inline shape's `?` is held exactly like an
 * interface's.
 */
function objectTypeMembers(text: string): TypeMember[] | undefined {
  const trimmed = text.trim();

  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;

  const out: TypeMember[] = [];
  const inner = trimmed.slice(1, -1);
  let depth = 0;
  let current = "";
  const parts: string[] = [];

  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i] as string;

    if (OPENERS.includes(char)) depth += 1;
    else if (CLOSERS.includes(char)) depth -= 1;
    else if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  for (const part of parts) {
    const trimmedPart = part.trim();

    if (trimmedPart === "") continue;

    const member =
      /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(
        trimmedPart,
      );

    if (!member) return undefined;

    out.push({
      name: member[1] as string,
      optional: member[2] === "?",
      type: (member[3] as string).replace(/\s+/g, " ").trim(),
    });
  }

  return out;
}

/**
 * The alternatives of a discriminated object union, or `undefined` if the alias
 * is anything else.
 *
 * "Discriminated" is decided by the SHAPE, not by looking for a member called
 * `kind`: the discriminant is whichever member every alternative declares as a
 * quoted literal, with a different literal in each. That is what makes a
 * `narrow on this` union narrowable, and it is what a docs table's first column
 * prints. Deciding it by name would leave `PretableMutationIssue` — which
 * discriminates on `code` — silently unrecognised.
 */
function discriminatedUnionOf(body: string): DiscriminatedUnion | undefined {
  const alternatives = topLevelAlternatives(body);

  if (alternatives.length < 2) return undefined;

  const parsed: TypeMember[][] = [];

  for (const alternative of alternatives) {
    const members = objectTypeMembers(alternative);

    if (!members) return undefined;

    parsed.push(members);
  }

  const isLiteral = (type: string): boolean => /^"[^"]*"$/.test(type);

  for (const candidate of (parsed[0] as { name: string; type: string }[])
    .filter((member) => isLiteral(member.type))
    .map((member) => member.name)) {
    const literals: string[] = [];

    for (const members of parsed) {
      const member = members.find((entry) => entry.name === candidate);

      if (!member || !isLiteral(member.type)) break;

      literals.push(member.type.slice(1, -1));
    }

    if (literals.length !== parsed.length) continue;
    if (new Set(literals).size !== literals.length) continue;

    return {
      discriminant: candidate,
      alternatives: parsed.map((members, index) => ({
        kind: literals[index] as string,
        carries: members
          .filter((member) => member.name !== candidate)
          .map((member) => member.name),
      })),
    };
  }

  return undefined;
}

/**
 * The alternatives of a string-literal union, or `undefined` if the alias is
 * anything else.
 *
 * Anything-else means anything at all: an object type, a function type, a union
 * with one non-literal branch. A partially literal union has no sentence-shaped
 * truth to compare a prose enumeration against, and pretending otherwise would
 * report the non-literal branch as a member the docs forgot.
 */
function stringUnionMembers(body: string): string[] | undefined {
  const parts = body
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\|/, "")
    .split("|")
    .map((part) => part.trim());

  // No empty-array guard: `String.prototype.split` never returns one, so a
  // check for it would be a branch no input can reach.
  if (!parts.every((part) => /^"[^"]*"$/.test(part))) return undefined;

  return parts.map((part) => part.slice(1, -1));
}

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
          type: declaredTypeText(lines, j, member),
        });
      }
    }

    members.set(open[1] as string, collected);
  }

  const unions = new Map<string, string[]>();
  const discriminatedUnions = new Map<string, DiscriminatedUnion>();

  for (const [name, body] of typeAliasBodies(raw)) {
    const literals = stringUnionMembers(body);

    if (literals) {
      unions.set(name, literals);
      continue;
    }

    const discriminated = discriminatedUnionOf(body);

    if (discriminated) discriminatedUnions.set(name, discriminated);
  }

  return { pkg, exports, members, unions, discriminatedUnions };
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
const FENCE_RE = /^[ \t]{0,15}(```|~~~)([^\n]*)\n([\s\S]*?)^[ \t]{0,15}\1/gm;

function fencedBlocks(raw: string): string[] {
  return [...raw.matchAll(FENCE_RE)].map((match) => match[3] as string);
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

/**
 * A type expression reduced to the one form both a report and a docs cell can
 * be compared in: whitespace collapsed, spaces around punctuation dropped, the
 * `\|` a table cell must escape unescaped, and the trailing separators
 * (`;` before a `}`, `,` before a closer) that only say where a line broke.
 *
 * Deliberately a normalisation and not a fuzzy match. Everything it erases is
 * something the two sides cannot help writing differently — a report is printed
 * by API Extractor, a table cell by a human inside a `|`-delimited row — and
 * nothing it erases changes what the type IS. `number` and `string` still
 * differ; so do `ReactNode` and `ReactElement`.
 */
function normalizeTypeText(text: string): string {
  return text
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .replace(/\s*([<>(){}[\],;:|&?])\s*/g, "$1")
    .replace(/[;,](?=[)}\]])/g, "")
    .replace(/;$/, "")
    .trim();
}

/**
 * The two sides of one `Type` cell, ready to compare.
 *
 * An OPTIONAL member's documented type may spell out the `| undefined` its `?`
 * already implies — `grid/clipboard.mdx` writes `locale?` as
 * `Intl.LocalesArgument | undefined` where the report writes
 * `locale?: Intl.LocalesArgument`. Those two say exactly the same thing to the
 * type checker, so the trailing alternative is dropped from both sides rather
 * than charged to the roster. It is dropped only for a member the report
 * declares optional: on a required member, `| undefined` is a real difference.
 */
function comparableTypes(
  claimed: string,
  member: TypeMember,
): { claimed: string; declared: string } {
  const strip = (text: string): string =>
    member.optional ? text.replace(/\|undefined$/, "") : text;

  return {
    claimed: strip(normalizeTypeText(claimed)),
    declared: strip(normalizeTypeText(member.type)),
  };
}

/**
 * Whether a `Type` cell is the declared type's string-literal alias EXPANDED —
 * `"text" | "number" | …` where the report declares `PretableColumnType`.
 *
 * A narrative table legitimately prints the values rather than the alias: on
 * `grid/filtering.mdx` that cell is the only place in the docs where a reader
 * learns which five `type`s exist, and printing `PretableColumnType` there
 * would send them looking for a page that does not spell it out.
 *
 * Held to the union rather than excused, which is the whole point. Registering
 * this row in {@link TYPE_CELL_EXCEPTIONS} would have been the cheap answer and
 * would have left the repo's only list of column types watched by nothing: add
 * a sixth to the union and the page would still confidently name five.
 *
 * Compared as SETS. Order in a union is not meaning, and the order a docs table
 * lists values in is editorial.
 */
function expandsStringUnion(
  claimed: string,
  declared: string,
  pkg: string,
): boolean {
  const members = report(pkg).unions.get(declared);

  if (!members) return false;

  const parts = claimed.split("|").map((part) => part.trim());

  if (!parts.every((part) => /^"[^"]*"$/.test(part))) return false;

  const documented = [
    ...new Set(parts.map((part) => part.slice(1, -1))),
  ].sort();

  return documented.join("|") === [...new Set(members)].sort().join("|");
}

/** The `Type` column of a member table, or -1. Never column 0 — that is the name. */
function typeColumn(table: DocsTable): number {
  return table.headers.findIndex(
    (header, index) => index > 0 && header.trim().toLowerCase() === "type",
  );
}

interface TypeRef {
  pkg: string;
  name: string;
  /**
   * A member of `name` whose declared type is an INLINE object literal, when the
   * table documents that object's members rather than `name`'s own.
   *
   * `PretableTelemetry.windowGap` is the case that asked for it: the shape is
   * two members the report spells out in full, and it has no exported name of
   * its own. Without this the only registration available was
   * `{ unbound: "…" }`, which buys a written reason and no checking at all —
   * and the table it would have excused is the only place in the docs where
   * `direction` and `rowCount` are named. That is precisely incident (4): the
   * page whose job is to be the list, watched by nothing.
   *
   * A path into the report, not an invention: the members are read out of
   * `windowGap`'s own declaration text with {@link objectTypeMembers}, which is
   * the same reader the union checks use, and a member that stops being an
   * inline object fails rather than degrading to a skip.
   */
  member?: string;
}

/** How a ref reads in a failure message: `PretableTelemetry.windowGap`. */
function refLabel(ref: TypeRef): string {
  return ref.member === undefined ? ref.name : `${ref.name}.${ref.member}`;
}

/**
 * The members a {@link TypeRef} names, or why they could not be read.
 *
 * Never both empty and problem-free. Every caller either reports the problem or
 * relies on another one having reported it, and none of them may treat "no
 * members" as "nothing to check" — that is the vacuous-green state this whole
 * file is built against.
 */
function resolveRefMembers(ref: TypeRef): {
  members: TypeMember[];
  problem?: string;
} {
  const declared = report(ref.pkg).members.get(ref.name);

  if (!declared) {
    return {
      members: [],
      problem: `"${ref.name}" is not an interface in ${ref.pkg}.api.md`,
    };
  }

  if (ref.member === undefined) return { members: declared };

  const owner = declared.find((entry) => entry.name === ref.member);

  if (!owner) {
    return {
      members: [],
      problem: `"${ref.name}" (@pretable/${ref.pkg}) has no member \`${ref.member}\`, so the inline shape this table documents is gone. Re-point the binding, or delete the table with the member.`,
    };
  }

  const inline = objectTypeMembers(owner.type);

  if (!inline || inline.length === 0) {
    return {
      members: [],
      problem: `"${ref.name}.${ref.member}" (@pretable/${ref.pkg}) is declared \`${owner.type}\`, which is not an inline object type whose members this file can read. If the shape was given a name, bind the table to that name instead.`,
    };
  }

  return { members: inline };
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
  "grid/tool-panel.mdx#Configuration": {
    types: [{ pkg: "react", name: "PretableToolPanelConfig" }],
    complete: true,
  },

  // The custom-section descriptor (SP4). `complete: true`: the table is the
  // page's statement of what a consumer authors, and a field growing on the
  // type without a row here would be exactly the unwatched drift this file
  // exists to catch.
  "grid/tool-panel.mdx#The descriptor": {
    types: [{ pkg: "react", name: "PretableToolPanelSection" }],
    complete: true,
  },
  "grid/paste.mdx#The payload": {
    types: [{ pkg: "react", name: "PastePayload" }],
    complete: true,
  },
  "grid/paste.mdx#The payload (table 2)": {
    types: [{ pkg: "react", name: "PastedCell" }],
    complete: true,
  },
  "grid/export.mdx#Options": {
    types: [{ pkg: "react", name: "PretableCsvOptions" }],
    complete: true,
  },
  "grid/clipboard.mdx#Building your own serializer": {
    types: [{ pkg: "react", name: "SerializeRangesArgs" }],
    complete: true,
  },

  // The telemetry payload. `complete: true` because this table is the only
  // list of it in the docs, and it had drifted before anything here could see
  // it: the page omitted `loadedRowCount` and `windowGap` outright and typed
  // `focusedRowId` as `string | null` where the report says
  // `TRowId | PretableGroupId | null`. Three wrong claims, in the table a
  // reader writes their `onTelemetryChange` handler against, with no roster
  // entry to say nobody was watching.
  "grid/pretable-surface.mdx#Telemetry": {
    types: [{ pkg: "react", name: "PretableTelemetry" }],
    complete: true,
  },

  // The near-edge signal's own two fields. `windowGap` is an inline object on
  // `PretableTelemetry` with no exported name, so this binds through the member
  // path rather than taking the `{ unbound: … }` escape — which was available,
  // and would have been wrong. The Telemetry table on `grid/pretable-surface`
  // prints the whole shape in ONE `Type` cell, so a renamed field fails there;
  // what nothing would have caught is this table not growing a row when
  // `windowGap` grows a field, and this is the only page that says what the
  // fields MEAN. That is incident (4) exactly: the list nobody was watching.
  // `complete: true` for the same reason — a reader writing an
  // `onTelemetryChange` handler treats these two rows as the whole payload.
  "server-data/windowing.mdx#Knowing when to fetch": {
    types: [{ pkg: "react", name: "PretableTelemetry", member: "windowGap" }],
    complete: true,
  },

  // The processing authority claim. Two fields, both optional, and the page
  // used to state them in a sentence — the one shape none of these checks can
  // read. `complete: true`: a third field would change what the reader has to
  // decide, and this is the page that owes them the list.
  "server-data/query-ownership.mdx#Processing authority": {
    types: [{ pkg: "react", name: "PretableProcessingOptions" }],
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
      'Documents `PretableRowChange`, which IS exported — but as a mapped-type-indexed union (`{ [K in ColumnIdOf<TColumns>]: {…} }[ColumnIdOf<TColumns>]`), and the member reader here handles interfaces and inline object members only, so binding it fails with "is not an interface". This excuse is therefore about the READER, not the type: teach `resolveRefMembers` to read the inner object literal out of that shape and this table can and should bind. Until then it is unchecked, and it has already drifted once — the `value` row claimed the committed value was "inferred from `columnId`" while `ColumnValueOf` resolved to `never` for every accessor-less column, which is every column the docs corpus teaches.',
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
  "grid/export.mdx#Options": true,
  "grid/tool-panel.mdx#Configuration": true,
  "grid/tool-panel.mdx#The descriptor": true,
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

/**
 * Bound member tables that carry a `Type` column, and what to do with it.
 *
 *   - `true` — every row's type cell is compared against the member's declared
 *     type, and the column must keep existing.
 *   - a string — why this table has no `Type` column at all.
 *
 * Until this existed, `complete: true` guaranteed the set of member NAMES and
 * their `?`, and nothing else: retyping `PretableDeltaProps.value`'s cell from
 * `number` to `string` was green, and a reader writing their handler against
 * that column got a compile error the docs promised them they would not.
 *
 * The column is found by its header, which is the editorial-rename hazard this
 * file has been bitten by twice — so the roster is what holds it, both ways. A
 * registered table whose `Type` header is renamed has no type column, which is
 * a failure here, not a silence; and a bound table that grows one without an
 * entry fails too.
 */
const MEMBER_TABLE_TYPES: Record<string, true | string> = {
  "grid/export.mdx#Options": true,
  "grid/tool-panel.mdx#Configuration": true,
  "grid/tool-panel.mdx#The descriptor": true,
  "grid/paste.mdx#The payload": true,
  "grid/paste.mdx#The payload (table 2)": true,
  "grid/clipboard.mdx#Building your own serializer": true,
  "grid/cell-presentations.mdx#PretableDelta": true,
  "grid/cell-presentations.mdx#PretableStatus": true,
  "grid/cell-presentations.mdx#PretableBadge": true,
  "grid/cell-presentations.mdx#PretableEntity": true,
  "grid/filtering.mdx#Column config": true,

  "grid/editing.mdx#Custom editors": true,

  "grid/pretable-surface.mdx#Telemetry": true,

  // `direction`'s cell prints `"before" | "after"` because that IS the declared
  // type — an inline union with no alias to name — so it is compared literally
  // rather than through {@link expandsStringUnion}, and adding a third edge to
  // the engine fails this row.
  "server-data/windowing.mdx#Knowing when to fetch": true,

  // Both cells print `"engine" | "external"` rather than the alias
  // `PretableProcessingAuthority`, and are held to the union by
  // {@link expandsStringUnion} rather than excused — the same treatment
  // `grid/filtering.mdx`'s `ColumnType` cell gets, and for the same reason:
  // this table is the only place in the docs those two values are listed.
  "server-data/query-ownership.mdx#Processing authority": true,
};

/**
 * Rows whose `Type` cell deliberately differs from the declared type, by
 * `<table key> / <member>`.
 *
 * A report prints the type as the compiler sees it, generic parameters and
 * all; a docs table prints it as the reader will meet it, with the type
 * arguments already bound and an alias expanded to the values it stands for.
 * Both are right, and the difference is not drift. What must never happen is a
 * row quietly removing itself from the comparison — the `splitRow` bug in this
 * file's history was exactly that, a check that passed on the rows it could not
 * read — so the escape is an entry here with a written reason, and it is
 * enforced in both directions: an entry whose row now MATCHES fails as a stale
 * exception, and an entry naming a row that does not exist fails too.
 */
const TYPE_CELL_EXCEPTIONS: Record<string, string> = {
  // `PastePayload` and `PastedCell` are generic in the row type AND in the row
  // ID type. The page introduces `TRow` and never `TRowId`, which defaults from
  // the row's own `id`, so it writes the bound form a reader of that page will
  // actually meet.
  "grid/paste.mdx#The payload / cells":
    "Writes `PastedCell<TRow>[]`; the report's second parameter, `TRowId`, is defaulted and is never introduced on this page.",
  "grid/paste.mdx#The payload / rejected":
    "Writes `RejectedPasteCell[]`; the report's `TRowId` parameter is defaulted and is never introduced on this page.",
  "grid/paste.mdx#The payload (table 2) / rowId":
    "Writes `string`, the bound form of `TRowId` — which is a parameter this page never introduces, constrained to `PretableRowId` (`string | number`).",

  // Two rows whose declared type is an inline object literal. The table prints
  // the field NAMES and lets its Notes column say what they count, which is
  // the substance: both fields are `number` in both shapes.
  "grid/paste.mdx#The payload / source":
    "Prints the inline shape's field names (`{ rows, columns }`) rather than repeating `: number` twice; the Notes column carries what they count.",
  "grid/paste.mdx#The payload / clipped":
    "Prints the inline shape's field names (`{ rows, columns }`) rather than repeating `: number` twice; the Notes column carries what they count.",
  "grid/clipboard.mdx#Building your own serializer / ranges":
    "Abbreviates the two inline `{ rowId, columnId }` literals as `CellAddress`; the report spells both out in full, twice, with their `readonly` modifiers.",

  // The alias here is an INTERFACE, so the string-union expansion below cannot
  // reach it, and the page is teaching the shape a reader must supply.
  "grid/filtering.mdx#Column config / options":
    "Expands the `ColumnOption` interface to the object literal a reader writes; the report names the interface. `ColumnOption` declares exactly `value: string` and `label?: string`.",

  // `PretableEditorInput` is generic in the cell's value type. A custom editor
  // is written against one column, so the page documents the erased form.
  "grid/editing.mdx#Custom editors / draft":
    "Writes `unknown` for the report's `TValue | string`; `TValue` is a parameter this page never introduces, and a custom editor narrows it itself.",
  "grid/editing.mdx#Custom editors / setDraft":
    "Writes `(value: unknown) => void` for the report's `(value: TValue | string) => void`; `TValue` is a parameter this page never introduces.",
};

// ---------------------------------------------------------------------------
// String-literal unions spelled out in prose
// ---------------------------------------------------------------------------

/**
 * A union's members, spelled out as a sentence, somewhere in the docs.
 *
 * A props table can only ever print the union's NAME in its `Type` column, so
 * the members themselves live in prose — and prose is the one shape none of the
 * checks above can see. `grid/cell-presentations.mdx` leans on that prose hard:
 * it is where a reader learns that a status has five tones and a badge four,
 * and it states in as many words that the badge union has no `neutral` member.
 * Dropping a member from either sentence, inventing one, or appending one all
 * shipped green.
 */
interface ProseEnumeration {
  page: string;
  /** The sentence itself, whitespace-collapsed, for the failure message. */
  sentence: string;
  /** The literals it names, in the order it names them. */
  literals: string[];
}

/**
 * Sentences on a page that enumerate `type`: the type's name in backticks,
 * followed — before the sentence ends — by at least one backticked string
 * literal.
 *
 * Both halves of that shape are load-bearing.
 *
 * The name is required in BACKTICKS, `` `PretableBadgeTone` ``, rather than
 * bare. Bare would also match the name inside a signature, and
 * `grid/editing.mdx` has one: the `commit` row prints
 * `` `(direction?: PretableFocusDirection) => void` `` and then, in the same
 * cell, `` (`"down"`, `"right"`, …) `` — a deliberate two-of-four SAMPLE behind
 * an explicit ellipsis. Reading that as an enumeration would fail a page that
 * is not wrong, and this file's own history says a check that fails on a
 * non-defect is a check the next author deletes.
 *
 * The literal is required in backticks too, and quoted, so that a name-drop
 * with no members listed is not read as an enumeration of zero.
 *
 * It is NOT what keeps the badge paragraph's next sentence — "There is
 * deliberately no `neutral` member" — out of the enumeration it comments on;
 * an earlier draft of this comment claimed that, and it is wrong. Sentence
 * segmentation does it: the enumerating sentence ends at its own period, and
 * the next one is a separate candidate that never names the type in backticks.
 * Writing that next sentence as ``no `"neutral"` member`` — the exact shape the
 * quoting rule was supposed to exclude — leaves this check green.
 *
 * A sentence ends at the first `.` followed by whitespace or end of text, so a
 * decimal inside one (`-0.2`) does not cut it short.
 */
function proseEnumerations(page: DocsPage, type: string): ProseEnumeration[] {
  const prose = withoutFences(page.raw);
  const nameRe = new RegExp("`" + type + "`", "g");
  const out: ProseEnumeration[] = [];

  for (const at of prose.matchAll(nameRe)) {
    const rest = prose.slice(at.index as number);
    const stop = /\.(?=\s|$)/.exec(rest);
    const sentence = rest.slice(0, stop ? stop.index + 1 : rest.length);
    const literals = [...sentence.matchAll(/`"([^"]*)"`/g)].map(
      (match) => match[1] as string,
    );

    if (literals.length === 0) continue;

    out.push({
      page: page.rel,
      sentence: sentence.replace(/\s+/g, " ").trim(),
      literals,
    });
  }

  return out;
}

/** The page whose prose spells this union out, and must keep doing so. */
interface EnumeratedUnion {
  page: string;
}

/** Why no page spells this union's members out. */
interface UnenumeratedUnion {
  unenumerated: string;
}

type UnionBinding = EnumeratedUnion | UnenumeratedUnion;

function isEnumerated(binding: UnionBinding): binding is EnumeratedUnion {
  return "page" in binding;
}

/**
 * `<pkg>/<TypeName>` → whether the docs spell its members out, for every
 * string-literal union the docs NAME anywhere.
 *
 * Same roster discipline as {@link TABLES}, and for the same reason: a checker
 * over a hand-picked list of unions to check is itself a hand-maintained list
 * that drifts. The expected set of keys is computed — every string-literal
 * union in every report, filtered to the ones a docs page names — so naming a
 * new union in the docs forces an entry here, and the author's only choice is
 * WHICH kind of entry, not whether their sentence gets checked.
 *
 * Enforced in every direction. A bound union's sentence must name exactly the
 * union's members: one omitted and one invented each fail, separately. A bound
 * union whose page carries no enumeration at all fails, because a check that
 * finds nothing to compare is the silence this whole file exists to prevent.
 * And an excused union that acquires an enumeration fails too — the excuse says
 * "no sentence to check", and the moment there is one it is checked or the
 * excuse is a lie.
 *
 * A duplicate key per package is not redundancy: `@pretable/core` and
 * `@pretable/react` each declare their own `ColumnType`, they are separately
 * generated, and they are free to drift apart.
 */
const STRING_UNIONS: Record<string, UnionBinding> = {
  // The two the cell-presentations page spells out. `PretableBadgeTone` is the
  // load-bearing one: the page states that it has no `neutral` member and
  // explains why, so a `neutral` appearing in the union — or a `"neutral"`
  // appearing in the sentence — makes the surrounding paragraph wrong.
  "react/PretableStatusTone": { page: "grid/cell-presentations.mdx" },
  "react/PretableBadgeTone": { page: "grid/cell-presentations.mdx" },

  // The tool-panel page's configuration section names the shipped section ids
  // outright — "today `"columns"`, `"filters"`, and `"grouping"`" — and the
  // page is built around that count: it documents exactly those three
  // sections, one `##` apiece. So a fourth id appearing in the union must
  // fail this until the sentence AND the sections around it are updated.
  "react/ToolPanelSectionId": { page: "grid/tool-panel.mdx" },

  // The body-state kinds, spelled out on the lifecycle page's
  // `renderBodyState` paragraph. The sentence counts them out loud — "one of
  // four" — so a fifth kind makes the prose wrong in two ways at once, and the
  // `kind === "error-strip"` branch in the fence beneath it is the thing a
  // reader copies.
  "react/PretableBodyStateKind": { page: "server-data/lifecycle.mdx" },

  // Named, never spelled out. Each of these appears once, in a "See also" list
  // of type names pointing at an API reference page — `ColumnType`,
  // `FilterOperator` on grid/filtering.mdx, `PretableEditStatus` on
  // grid/editing.mdx. A list of names is not an enumeration of members, and
  // there is nothing there for this check to hold.
  "core/ColumnType": {
    unenumerated:
      "grid/filtering.mdx names it in a cross-reference list of types; no page spells its members out.",
  },
  "react/ColumnType": {
    unenumerated:
      "grid/filtering.mdx names it in a cross-reference list of types; no page spells its members out.",
  },
  "core/FilterOperator": {
    unenumerated:
      "grid/filtering.mdx names it in a cross-reference list of types; no page spells its members out.",
  },
  "react/FilterOperator": {
    unenumerated:
      "grid/filtering.mdx names it in a cross-reference list of types; no page spells its members out.",
  },
  "core/PretableEditStatus": {
    unenumerated:
      "grid/editing.mdx names it in a cross-reference list of types; no page spells its members out.",
  },
  "react/PretableEditStatus": {
    unenumerated:
      "grid/editing.mdx names it in a cross-reference list of types; no page spells its members out.",
  },

  // grid/editing.mdx's `commit` row shows two of the four movements behind an
  // explicit `…`. That is a sample, deliberately partial, and holding a sample
  // to the full union would fail a page that is not wrong.
  "core/PretableFocusDirection": {
    unenumerated:
      "grid/editing.mdx shows two of its members as an explicit `…` sample inside a signature, not as an enumeration.",
  },
  "react/PretableFocusDirection": {
    unenumerated:
      "grid/editing.mdx shows two of its members as an explicit `…` sample inside a signature, not as an enumeration.",
  },
};

/** The bare name of `type`, wherever it appears on a page — prose or fence. */
function docsNameUnion(type: string): boolean {
  const bareRe = new RegExp(`(?<![\\wɵ])${type}(?![\\w])`);

  return PAGES.some((page) => bareRe.test(page.raw));
}

/** `<pkg>/<TypeName>` for every string-literal union some docs page names. */
function namedStringUnions(): string[] {
  const out: string[] = [];

  for (const pkg of REPORTED_PACKAGES) {
    for (const type of report(pkg).unions.keys()) {
      if (docsNameUnion(type)) out.push(`${pkg}/${type}`);
    }
  }

  return out.sort();
}

// ---------------------------------------------------------------------------
// Tool-panel message keys listed in prose
// ---------------------------------------------------------------------------

/** The page whose sections list the tool panel's `messages` keys. */
const TOOL_PANEL_PAGE = "grid/tool-panel.mdx";

/** The interface that declares every `toolPanel*` message key. */
const MESSAGES_INTERFACE = "PretableSurfaceMessages";

/**
 * A key the page lists, and where. `via` is the covering phrase the listing
 * names it through instead of spelling it out — see
 * {@link TOOL_PANEL_MESSAGE_KEYS} for the two shapes in use.
 */
interface ListedMessageKey {
  /** The `##` section whose prose must carry the key (or its `via` phrase). */
  section: string;
  /**
   * A phrase that must appear in the section's prose, standing in for the
   * bare key. A wildcard phrase (`` `toolPanelFilter*` ``) is additionally
   * required to actually cover the key's name; any other phrase is held to
   * existing, which is what keeps rewording the sentence from silently
   * retiring the coverage it carries.
   */
  via?: string;
}

/** Why no listing names this key at all. */
interface UnlistedMessageKey {
  unlisted: string;
}

type MessageKeyBinding = ListedMessageKey | UnlistedMessageKey;

function isListed(binding: MessageKeyBinding): binding is ListedMessageKey {
  return "section" in binding;
}

/**
 * Every `toolPanel*` member of {@link MESSAGES_INTERFACE}, and where the
 * tool-panel page lists it.
 *
 * Same roster discipline as {@link TABLES} and {@link STRING_UNIONS}, and the
 * expected key set is computed from the react report — so declaring a new
 * `toolPanel*` message forces an entry here, and the author's only choice is
 * WHICH kind of entry, not whether their key gets checked. The listings
 * themselves are prose paragraphs ("Every string is a message: …"), the one
 * shape no table or union check above can see: deleting
 * `toolPanelExpandAllLabel` from the grouping section's listing left the whole
 * suite green, verified by mutation.
 *
 * Enforced in every direction. A bound key must appear backticked in its
 * section's prose; a `via`-bound key's covering phrase must still be there,
 * and a `via` whose key the section now names outright is stale and fails; an
 * `unlisted` key that acquires a mention anywhere on the page fails too,
 * because the excuse says "nothing here to check" and the moment there is
 * something it is checked or the excuse is a lie.
 *
 * When adding a message key: name it in the owning section's strings
 * paragraph on {@link TOOL_PANEL_PAGE} AND add its entry here — both, in the
 * same change.
 */
const TOOL_PANEL_MESSAGE_KEYS: Record<string, MessageKeyBinding> = {
  // The rail's accessible name and the three section tab labels, named in the
  // configuration section's localization sentence.
  toolPanelLabel: { section: "Configuration" },
  toolPanelColumnsLabel: { section: "Configuration" },
  toolPanelFiltersLabel: { section: "Configuration" },
  toolPanelGroupingLabel: { section: "Configuration" },

  // The filters section's strings paragraph names these outright…
  toolPanelAddFilterLabel: { section: "The filters section" },
  toolPanelAddGroupLabel: { section: "The filters section" },
  toolPanelRemoveFilterLabel: { section: "The filters section" },
  toolPanelNoFiltersMessage: { section: "The filters section" },
  toolPanelNoFilterValuesMessage: { section: "The filters section" },
  // …and the grouped-away marker is named earlier in the same section, where
  // the page explains what the marker is for.
  toolPanelColumnGroupedMarker: { section: "The filters section" },

  // …covers the row-control and join labels as "the `toolPanelFilter*`
  // labels" — a wildcard the check verifies actually covers each key…
  toolPanelFilterColumnLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterOperatorLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterValueLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterValuesLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterWhereLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterMinimumLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterMaximumLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterJoinLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },
  toolPanelFilterJoinActionLabel: {
    section: "The filters section",
    via: "`toolPanelFilter*`",
  },

  // …and names the two refusal messages outright, in the parenthetical after
  // "the two refusal sentences". Bound plain rather than via that phrase: a
  // phrase with no mechanical tie to the keys it covers survives a reword
  // that keeps the words while inverting the meaning, and the bare names do
  // not.
  toolPanelFilterDepthRefusal: { section: "The filters section" },
  toolPanelNoFilterColumnsRefusal: { section: "The filters section" },

  // The grouping section's strings paragraph names these outright.
  toolPanelGroupByLabel: { section: "The grouping section" },
  toolPanelAddRowGroupLabel: { section: "The grouping section" },
  toolPanelRemoveGroupLabel: { section: "The grouping section" },
  toolPanelReorderGroupLabel: { section: "The grouping section" },
  toolPanelNoGroupsMessage: { section: "The grouping section" },
  toolPanelExpandAllLabel: { section: "The grouping section" },
  toolPanelCollapseAllLabel: { section: "The grouping section" },
  toolPanelHideGroupedColumnsLabel: { section: "The grouping section" },
  toolPanelAggregatesLabel: { section: "The grouping section" },
  toolPanelAggregateColumnLabel: { section: "The grouping section" },
  toolPanelAggregateDefaultOption: { section: "The grouping section" },
  toolPanelAggregateNoneOption: { section: "The grouping section" },
  toolPanelAggregateCustomLabel: { section: "The grouping section" },
  toolPanelAggregateSumLabel: { section: "The grouping section" },
  toolPanelAggregateCountLabel: { section: "The grouping section" },

  // The three middle builtins ride the range "the five builtin names
  // (`toolPanelAggregateSumLabel` through `toolPanelAggregateCountLabel`)".
  // The endpoints are bound plain above; the phrase is what covers the middle,
  // and rewording it fails these three until they are named or re-covered.
  toolPanelAggregateAvgLabel: {
    section: "The grouping section",
    via: "`toolPanelAggregateSumLabel` through `toolPanelAggregateCountLabel`",
  },
  toolPanelAggregateMinLabel: {
    section: "The grouping section",
    via: "`toolPanelAggregateSumLabel` through `toolPanelAggregateCountLabel`",
  },
  toolPanelAggregateMaxLabel: {
    section: "The grouping section",
    via: "`toolPanelAggregateSumLabel` through `toolPanelAggregateCountLabel`",
  },

  // The columns section describes its controls in prose but ships no strings
  // listing — it predates the "DOM hooks and strings" convention the other two
  // sections follow. These keys are therefore listed nowhere on the page, and
  // that is recorded rather than silently true. If a strings paragraph is
  // added to the columns section, bind these to it.
  toolPanelColumnGroupLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelColumnMenuLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelNoColumnsMatchMessage: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelPinLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelReorderColumnLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelResetColumnsLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelSearchColumnsLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelSearchColumnsPlaceholder: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
  toolPanelShowColumnLabel: {
    unlisted: "the columns section has no strings listing to name it in.",
  },
};

/**
 * The prose of one `##` section of a page — from its heading line to the next
 * `##` at the same level — with fenced blocks already stripped, so a key named
 * only inside a code sample does not count as listed.
 */
function sectionProse(page: DocsPage, heading: string): string | undefined {
  const lines = withoutFences(page.raw).split("\n");
  const start = lines.findIndex(
    (line) =>
      /^##\s+(.+?)\s*$/.exec(line)?.[1]?.replace(/`/g, "").trim() === heading,
  );

  if (start < 0) return undefined;

  let end = start + 1;

  while (end < lines.length && !/^##\s/.test(lines[end] as string)) end += 1;

  return lines.slice(start, end).join("\n");
}

/** A backticked mention of exactly this key: `` `toolPanelExpandAllLabel` ``. */
function namesKey(prose: string, key: string): boolean {
  return prose.includes(`\`${key}\``);
}

// ---------------------------------------------------------------------------
// Discriminated unions drawn as a table
// ---------------------------------------------------------------------------

/**
 * Every discriminant name the reports use — `kind`, `code` — lowercased.
 *
 * Computed, not listed. The table detector below asks whether a first header
 * ENDS in one of these (`status.kind`, `focus.kind`, a bare `kind`), and a
 * hand-written set would answer "no" for the first union that discriminates on
 * something else, silently, which is the failure this whole file is about.
 */
function discriminantNames(): Set<string> {
  const out = new Set<string>();

  for (const pkg of REPORTED_PACKAGES) {
    for (const union of report(pkg).discriminatedUnions.values()) {
      out.add(union.discriminant.toLowerCase());
    }
  }

  return out;
}

let discriminantNameCache: Set<string> | undefined;

function knownDiscriminants(): Set<string> {
  discriminantNameCache ??= discriminantNames();

  return discriminantNameCache;
}

/**
 * Tables whose first column IS a union's discriminant.
 *
 * A separate detector for the same reason {@link tokenTables} is one:
 * {@link MEMBER_TABLE_HEADERS} fires on `prop`/`field`/`option`/`method`, and
 * this table's first header is `` `status.kind` ``. It documents no interface's
 * members — every row is one ALTERNATIVE of a union — so it was invisible to
 * the member-table roster too, and therefore registered nowhere at all.
 *
 * Matched on the header's last dot-segment so that `status.kind`, `focus.kind`
 * and a bare `kind` all resolve. That is editorial prose, exactly like a theme
 * column's leading word — and it is switchable off by a copy edit for exactly
 * as long as nothing else is watching. The roster below is what watches: a
 * registered table that stops being detected is a missing key, not a silence.
 */
function discriminantTables(page: DocsPage): DocsTable[] {
  return tablesOfKind(page, (first) => {
    const segments = first.replace(/`/g, "").trim().split(".");

    return knownDiscriminants().has(segments[segments.length - 1] ?? "");
  });
}

const ALL_DISCRIMINANT_TABLES = PAGES.flatMap(discriminantTables);

/** A cell that says an alternative carries nothing else. */
const CARRIES_NOTHING_RE = /^[—–-]$/;

/** A cell that lists the members an alternative carries, all backticked. */
const CARRIED_LIST_RE =
  /^`[A-Za-z_$][A-Za-z0-9_$]*`(?:\s*,\s*`[A-Za-z_$][A-Za-z0-9_$]*`)*$/;

/**
 * Columns that read as "the other members this alternative carries" on EVERY
 * row — a dash, or a comma-separated list of backticked identifiers.
 *
 * Bound by cell shape rather than by header text, and for the reason
 * {@link optionalityColumns} is: `Also carries` is a phrase an author may
 * reword, and a header-bound column is one a copy edit can retire. The `Means`
 * column beside it is prose and does not have this shape, so exactly one column
 * resolves; if two ever did, the check below fails rather than guessing.
 *
 * Column 0 is excluded because the discriminant column has this shape too — its
 * cells are single backticked identifiers.
 */
function carriedFieldsColumns(table: DocsTable): number[] {
  if (table.rows.length === 0) return [];

  const out: number[] = [];

  table.headers.forEach((_header, index) => {
    if (index === 0) return;

    const cells = table.rows.map((row) => (row[index] ?? "").trim());

    if (
      cells.every(
        (cell) => CARRIES_NOTHING_RE.test(cell) || CARRIED_LIST_RE.test(cell),
      )
    ) {
      out.push(index);
    }
  });

  return out;
}

function carriedFields(cell: string): string[] {
  return [...cell.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)`/g)].map(
    (match) => match[1] as string,
  );
}

/** The union a discriminant table draws, and whether its carried column counts. */
interface TabledUnion {
  pkg: string;
  type: string;
  /**
   * `true` — the carried-members column is held to each alternative's OTHER
   * members, both ways. A string — why this table has no such column.
   *
   * The carried half is the half most likely to drift: adding a field to one
   * alternative of a union is a routine change, and nothing about it touches
   * the `kind` list a reader scans first.
   */
  carries: true | string;
}

/**
 * The alternatives a bound table is held to: a discriminated object union's, or
 * a STRING-literal union's members read as alternatives that carry nothing.
 *
 * The second form exists because `grid/editing.mdx`'s `| Phase | Meaning |`
 * table is one — five rows, one per member of `PretableEditStatus` — and it is
 * the docs' only list of them. {@link STRING_UNIONS} could not hold it either:
 * that check reads PROSE, a sentence naming the type and its literals, and this
 * page has a table instead. So the two union checks between them left a table
 * that IS a union's list bound to nothing, and registering it `unbound` would
 * have written that hole down rather than closed it.
 *
 * A string union's alternatives carry nothing, which is not a weakening: a
 * carried-members column on such a table would be comparing a list against the
 * empty set, and would fail — correctly, because a string literal has no
 * members to carry.
 */
function boundUnionAlternatives(
  pkg: string,
  type: string,
): DiscriminatedUnion | undefined {
  const discriminated = report(pkg).discriminatedUnions.get(type);

  if (discriminated) return discriminated;

  const literals = report(pkg).unions.get(type);

  if (!literals) return undefined;

  return {
    discriminant: type,
    alternatives: literals.map((literal) => ({ kind: literal, carries: [] })),
  };
}

/** Why a table that looks like a union's alternatives documents no union. */
interface UntabledUnion {
  unbound: string;
}

type DiscriminantTableBinding = TabledUnion | UntabledUnion;

function isTabledUnion(
  binding: DiscriminantTableBinding,
): binding is TabledUnion {
  return "type" in binding;
}

/**
 * Every table in the docs whose first column is a union discriminant, and which
 * union it draws.
 *
 * Same roster discipline as {@link TABLES}, and the expected key set is
 * computed from the docs the same way: a new `| kind |` table anywhere in the
 * corpus is bound to a reported union or excused with a written reason, and
 * the author's choice is WHICH, never whether it gets checked. That closes the
 * decoy route as well — a second `status.kind` table on a neighbouring page
 * cannot quietly exist, correct-looking, while the real one drifts.
 *
 * Note the key namespace: {@link tablesOfKind} numbers per KIND, so this key
 * may read the same as a {@link TABLES} key for a different table under the
 * same heading. That is deliberate — it is what stops a new table of one kind
 * renumbering another kind's keys out from under its roster.
 */
const DISCRIMINANT_TABLES: Record<string, DiscriminantTableBinding> = {
  // The row-model status table. `@pretable/react` re-exports the same union,
  // and the page is about `@pretable/core`'s row model, so it is bound to core
  // — the two reports are generated separately and are free to drift, and this
  // page teaches the core one.
  "headless/state-model.mdx#Row-model state": {
    pkg: "core",
    type: "PretableRowModelStatus",
    carries: true,
  },
  // The CSV export's incompleteness union. Bound to `react`, which is where it
  // is declared — the page is about the React surface's export.
  "grid/export.mdx#The file tells you what it could not contain": {
    pkg: "react",
    type: "PretableCsvOmission",
    carries: true,
  },
  // The lifecycle phases. Bound to `react`: `PretableDataState` is declared
  // there and nowhere else, and the page teaches it as a `<PretableSurface>`
  // prop.
  "server-data/lifecycle.mdx#The six phases": {
    pkg: "react",
    type: "PretableDataState",
    carries: true,
  },
  // The total's three strengths. Bound to `react` for the reason the export
  // entry is: the page teaches it as `resultMeta.total` on the React surface,
  // and `@pretable/core` declares its own copy that is free to drift.
  "server-data/totals.mdx#The three shapes": {
    pkg: "react",
    type: "PretableMatchingTotal",
    carries: true,
  },
  // A STRING union drawn as a table, and the first one this file has had to
  // hold. It became visible only when the alias reader stopped choking on
  // TSDoc: `PretableDataState` contributed `phase` to the discriminant names,
  // and this table's `Phase` header has ended in one ever since — it simply
  // had no name to end in before. It is not a decoy and it is not ad hoc: it
  // is the docs' only list of the five edit phases, and it had been drifting
  // unwatched for as long as it existed.
  "grid/editing.mdx#Lifecycle": {
    pkg: "react",
    type: "PretableEditStatus",
    carries:
      "A string union's alternatives carry nothing, so there is no such column and there must not be one.",
  },
};

// ---------------------------------------------------------------------------
// Fences and the fixtures that prove they compile
// ---------------------------------------------------------------------------

/**
 * The directory holding the compile-time fixtures. These are `.types.tsx`
 * files, not `.test.tsx` ones: nothing in them runs, and `tsc --noEmit` over
 * the app is what asserts them.
 */
const FIXTURE_DIR = path.join(__dirname, "../../../app/docs/__tests__");

const FIXTURE_SUFFIX = ".types.tsx";

/**
 * The fixtures that must exist, named the way {@link TOKEN_REFERENCE} is.
 *
 * Every other rule here is scoped to the fixtures on disk, which leaves one
 * move unwatched: delete the file. The page keeps its snippets, no marker names
 * them, the page is no longer "bound", and every check below has nothing to
 * say. A page rewrite that takes its fixture with it is an ordinary way to get
 * there. So the set is asserted both ways — a fixture that disappears fails,
 * and a new one has to be named here, which is the same registration cost every
 * other roster in this file charges.
 */
const FIXTURE_FILES = [
  "cell-presentations.types.tsx",
  "csv-export.types.tsx",
  "headless-getting-started.types.tsx",
  "server-data.types.tsx",
];

/** A fenced block, keyed by the heading it sits under. */
interface DocsFence {
  /** `headless/getting-started.mdx#Subscribe`, ` (fence 2)` for a sibling. */
  key: string;
  page: string;
  info: string;
  body: string;
}

/**
 * Every fenced block on a page, in document order, with the heading it sits
 * under — the same keying {@link tablesOfKind} gives a table, and numbered per
 * page-and-heading so that adding a fence under a new heading cannot renumber
 * another one's key out from under the roster.
 *
 * Headings inside a fence body are ignored. A `#` at the start of a line in a
 * shell or CSS snippet is a comment, not a section, and letting one through
 * would rekey every fence after it.
 */
function docsFences(page: DocsPage): DocsFence[] {
  const matches = [...page.raw.matchAll(FENCE_RE)];
  const spans = matches.map((match) => ({
    start: match.index as number,
    end: (match.index as number) + (match[0] as string).length,
  }));
  const headings = [...page.raw.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].filter(
    (heading) =>
      !spans.some(
        (span) =>
          (heading.index as number) >= span.start &&
          (heading.index as number) < span.end,
      ),
  );
  const seenPerHeading = new Map<string, number>();
  const out: DocsFence[] = [];

  for (const match of matches) {
    const at = match.index as number;
    const enclosing = headings.filter(
      (heading) => (heading.index as number) < at,
    );
    const last = enclosing[enclosing.length - 1];
    const heading = last
      ? (last[1] as string).replace(/`/g, "").trim()
      : "(top)";
    const nth = (seenPerHeading.get(heading) ?? 0) + 1;

    seenPerHeading.set(heading, nth);

    out.push({
      key: `${page.rel}#${heading}${nth > 1 ? ` (fence ${nth})` : ""}`,
      page: page.rel,
      info: (match[2] as string).trim(),
      body: match[3] as string,
    });
  }

  return out;
}

const ALL_FENCES = PAGES.flatMap(docsFences);

/**
 * A snippet reduced to its tokens: string literals whole, identifiers and
 * numbers whole, every other character on its own. Comments are dropped.
 *
 * Tokens rather than text because both sides are prettier's output at different
 * widths — the docs fence wraps `column.accessor("latencyMs", { … })` over four
 * lines where the fixture fits it on one — and reflowing a snippet is not
 * drift. Tokens rather than lines for the same reason.
 *
 * Written as a scanner rather than a regex because a regex that strips `//`
 * comments cannot tell one from the `//` inside `"https://…"`, and getting that
 * wrong truncates a snippet's tokens and fails a fixture that is correct.
 */
function codeTokens(source: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i] as string;

    if (char === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);

      i = newline < 0 ? source.length : newline;
      continue;
    }

    if (char === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);

      i = close < 0 ? source.length : close + 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let j = i + 1;

      while (j < source.length && source[j] !== char) {
        j += source[j] === "\\" ? 2 : 1;
      }

      tokens.push(source.slice(i, Math.min(j + 1, source.length)));
      i = j + 1;
      continue;
    }

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    const word = /^[A-Za-z_$][A-Za-z0-9_$]*|^\d[\d._A-Za-z]*/.exec(
      source.slice(i),
    )?.[0];

    if (word) {
      tokens.push(word);
      i += word.length;
      continue;
    }

    tokens.push(char);
    i += 1;
  }

  // A trailing comma is prettier's, not the author's: it appears when a call or
  // literal is wrapped over lines and disappears when it fits on one, and both
  // forms are the same code.
  return tokens.filter(
    (token, index) =>
      !(token === "," && ["}", ")", "]"].includes(tokens[index + 1] ?? "")),
  );
}

/**
 * The index in `haystack` just past where `needle` finishes matching as a
 * SUBSEQUENCE, or the index in `needle` of the first token that could not be
 * placed.
 *
 * Subsequence, not equality, and the asymmetry is the design. A fixture must
 * reproduce everything its fence shows, in order — that is the claim the page
 * makes to a reader who pastes it — but it is free to add what a partial
 * snippet needs to compile: the rows the snippet assumes, a `return` around a
 * bare JSX expression, an `export` on a binding, and the merged imports that
 * four one-import snippets cannot each repeat.
 *
 * DECLINED, deliberately: a fence that only DELETES tokens still matches. The
 * fixture then proves more than the page shows, which is not a stale fixture —
 * everything the reader is now shown is still compiled. The direction that
 * matters is the other one, and it is closed at n=1: any token a fence gains or
 * changes must appear in the fixture, or this fails.
 */
function subsequenceGap(needle: string[], haystack: string[]): number {
  let at = 0;

  for (let i = 0; i < needle.length; i += 1) {
    const found = haystack.indexOf(needle[i] as string, at);

    if (found < 0) return i;

    at = found + 1;
  }

  return -1;
}

/** One `// docs-fence:` region of a fixture. */
interface FixtureRegion {
  /** The fixture's basename. */
  fixture: string;
  /** The fence key the marker names. */
  fence: string;
  /** The preamble plus this region — what the fence must be found inside. */
  tokens: string[];
}

const FIXTURE_MARKER_RE = /^[ \t]*\/\/ docs-fence:[ \t]*(.+?)[ \t]*$/gm;

/**
 * The regions of every fixture file.
 *
 * A region runs from its marker to the next marker or the end of the file, and
 * everything before the FIRST marker is a preamble prepended to all of them.
 * The preamble is what lets four snippets that each open with their own
 * one-name import share a single merged import statement, and what lets a
 * snippet referring to `rows` compile in a file that has to declare them.
 *
 * Regions are the anchor, and that is their point. Matching a fence against the
 * whole file would let its tokens be satisfied from anywhere — a `"warning"`
 * borrowed from the status example three declarations up would quietly cover a
 * badge example whose tones had been swapped. A region is small enough that a
 * reworded snippet has nowhere to hide.
 */
function fixtureRegions(): FixtureRegion[] {
  const out: FixtureRegion[] = [];

  for (const name of fs.readdirSync(FIXTURE_DIR).sort()) {
    if (!name.endsWith(FIXTURE_SUFFIX)) continue;

    const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
    const markers = [...raw.matchAll(FIXTURE_MARKER_RE)];

    if (markers.length === 0) {
      out.push({ fixture: name, fence: "", tokens: [] });
      continue;
    }

    const preamble = codeTokens(raw.slice(0, markers[0]?.index as number));

    markers.forEach((marker, index) => {
      const start = (marker.index as number) + (marker[0] as string).length;
      const end =
        (markers[index + 1]?.index as number | undefined) ?? raw.length;

      out.push({
        fixture: name,
        fence: marker[1] as string,
        tokens: [...preamble, ...codeTokens(raw.slice(start, end))],
      });
    });
  }

  return out;
}

const FIXTURE_REGIONS = fixtureRegions();

/** The pages some fixture transcribes; every fence on one is accounted for. */
function fixtureBoundPages(): Set<string> {
  return new Set(
    FIXTURE_REGIONS.map(
      (region) => region.fence.split("#")[0] as string,
    ).filter((page) => page !== ""),
  );
}

/**
 * Fences on a fixture-bound page that no fixture transcribes, and why.
 *
 * The escape hatch for a fence that cannot be transcribed — a shell command, a
 * console transcript, a snippet whose whole point is that it does NOT compile —
 * and it costs a written reason like every other escape here. Enforced both
 * ways: an entry for a fence that is now transcribed, or for one that no longer
 * exists, fails.
 */
const UNTRANSCRIBED_FENCES: Record<string, string> = {};

/**
 * Bindings a fixture renames, per fence: fence identifier → fixture identifier.
 *
 * One file cannot declare `columns` four times, and the pages it transcribes do
 * not have to care. A rename is therefore legitimate — and it is also the
 * obvious place to hide a fixture that has stopped matching its fence, so it is
 * declared here rather than inferred, and it is enforced: a rename the fence
 * matches WITHOUT is a stale entry and fails.
 */
const FENCE_RENAMES: Record<string, Record<string, string>> = {
  // `cell-presentations.types.tsx` transcribes four fences into one module, and
  // the `PretableDelta` one declares the generic `columns`.
  "grid/cell-presentations.mdx#PretableDelta": { columns: "deltaColumns" },
};

function renameTokens(
  tokens: string[],
  renames: Record<string, string>,
): string[] {
  return tokens.map((token) => renames[token] ?? token);
}

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

/** The presence list every theme is held to — the token contract itself. */
const CONTRACT_TEST = path.join(
  REPO_ROOT,
  "packages/ui/src/__tests__/contract.test.ts",
);

const THEMES_DIR = path.join(REPO_ROOT, "packages/ui/themes");

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

  test("every Pretable-prefixed type the docs NAME is a real export", () => {
    // The import check above reads `import { X } from "@pretable/*"`. A type
    // named in prose is invisible to it, and prose is where the escape hatches
    // live: "take it as `PretableRenderSnapshot['rowMetrics']` if you need to
    // write the type down" outlived the type by an entire release. #321
    // renamed it to `PretableIndexedRenderSnapshot`, the reports were
    // regenerated, every table stayed bound — and the one sentence telling a
    // reader what to type still named something that no longer existed.
    //
    // Scans the whole page, fences included: a name is a name wherever it is
    // written, and this check is cheap enough not to need the distinction.
    const exported = new Set<string>();
    for (const pkg of REPORTED_PACKAGES) {
      for (const name of report(pkg).exports) exported.add(name);
    }

    // Fail closed. If the corpus stops yielding names, the sweep has gone
    // blind rather than clean — every page in this section names some
    // `Pretable*` type.
    const named = PAGES.flatMap((page) =>
      [...page.raw.matchAll(/\b(Pretable[A-Z][A-Za-z0-9_]*)\b/g)].map(
        (match) => ({ page: page.rel, name: match[1] as string }),
      ),
    );
    expect(
      named.length,
      `no \`Pretable*\` identifier appears anywhere under ${DOCS_ROOT}. The ` +
        "docs cannot have stopped naming the library's types; this sweep is " +
        "reading an empty corpus.",
    ).toBeGreaterThan(0);

    const unknown = [
      ...new Map(
        named
          .filter(({ name }) => !exported.has(name))
          .map((hit) => [`${hit.page}:${hit.name}`, hit]),
      ).values(),
    ];

    expect(
      unknown,
      [
        "A docs page names a `Pretable*` type that no package exports, so a",
        "reader who writes it down gets a compile error. Renames land in the",
        "reports and the tables bound to them; prose does not move on its own.",
        "",
        ...unknown.map(({ page, name }) => `${page}: ${name}`),
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
      let unresolved = 0;

      for (const ref of binding.types) {
        const resolved = resolveRefMembers(ref);

        if (resolved.problem) {
          unresolved += 1;
          problems.push(`${table.key}: ${resolved.problem}`);
          continue;
        }

        for (const member of resolved.members) {
          if (!members.has(member.name)) members.set(member.name, member);
        }
      }

      // Fail closed rather than skip. `declared` is an empty array — not
      // `undefined` — the moment MEMBER_RE stops matching the report's layout,
      // so a `continue` here turned every bound table into a no-op for free.
      //
      // Guarded on `unresolved` only so a ref that already said WHY it read
      // nothing does not also get told it must be MEMBER_RE — two messages for
      // one cause, the second of them wrong. A ref that resolves and still
      // yields nothing is the silent parse break, and still fails here.
      if (members.size === 0) {
        if (unresolved === 0) {
          problems.push(
            `${table.key}: ${binding.types
              .map((ref) => `${refLabel(ref)} (@pretable/${ref.pkg})`)
              .join(" / ")} parsed to zero members. The interface is in the ` +
              "report, so MEMBER_RE stopped matching its declarations and " +
              "this table is being checked against nothing.",
          );
        }

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
              .map((ref) => refLabel(ref))
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
                .map((ref) => `${refLabel(ref)} (@pretable/${ref.pkg})`)
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
        for (const member of resolveRefMembers(ref).members) {
          if (!documented.has(member.name)) missing.push(member.name);
        }
      }

      if (missing.length > 0) {
        problems.push(
          `${tables.join(" + ")}: claims to document all of ${refs
            .map((ref) => refLabel(ref))
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

  test("a bound member table's Type column matches the declared type", () => {
    const problems: string[] = [];
    /** Exception keys reached, for the staleness sweep. */
    const usedExceptions = new Set<string>();
    /** Type cells actually compared against a declared type. */
    let typesChecked = 0;

    for (const table of ALL_TABLES) {
      const binding = TABLES[table.key];

      if (!binding || !isBound(binding)) continue;

      const column = typeColumn(table);
      const registration = MEMBER_TABLE_TYPES[table.key];

      if (registration === undefined) {
        if (column >= 0) {
          problems.push(
            `${table.key}: has a \`Type\` column but is not in MEMBER_TABLE_TYPES. Register it \`true\` so every cell is held to the member's declared type, or with a written reason if it cannot be.`,
          );
        }

        continue;
      }

      if (registration !== true) {
        // The excuse outlived the absence it excused. Left standing, it waves
        // through whatever the column now claims.
        if (column >= 0) {
          problems.push(
            `${table.key}: excused in MEMBER_TABLE_TYPES ("${registration}"), but it now has a \`Type\` column. Register it \`true\` so the column is checked, or delete the column.`,
          );
        }

        continue;
      }

      if (column < 0) {
        problems.push(
          `${table.key}: registered in MEMBER_TABLE_TYPES as carrying a \`Type\` column, but no header past the first reads \`Type\` — headers are [${table.headers.join(
            " | ",
          )}]. Renaming that header is a copy edit that takes every one of this table's type claims out of the check; restore it, or say here why the table no longer has one.`,
        );
        continue;
      }

      // The package is carried alongside the member: an expanded alias has to
      // be looked up in the report the member was declared in.
      const members = new Map<string, { member: TypeMember; pkg: string }>();

      for (const ref of binding.types) {
        for (const member of resolveRefMembers(ref).members) {
          if (!members.has(member.name)) {
            members.set(member.name, { member, pkg: ref.pkg });
          }
        }
      }

      for (const row of table.rows) {
        for (const name of documentedNames(row[0] ?? "").names) {
          const entry = members.get(name);

          // A member the type does not have is the previous check's failure to
          // report; do not say it twice.
          if (!entry) continue;

          const member = entry.member;

          const cell = row[column] ?? "";
          const inTicks = backticked(cell);
          const key = `${table.key} / ${name}`;
          const excuse = TYPE_CELL_EXCEPTIONS[key];

          // Reported, never skipped. A cell this file cannot read is a cell
          // whose claim is unchecked, and the whole lesson of `splitRow` is
          // that a check which silently passes on the rows it cannot read is
          // worse than no check: it reports green over exactly the rows that
          // are wrong.
          if (!inTicks) {
            problems.push(
              `${table.key}: the \`Type\` cell for \`${name}\` is ${JSON.stringify(
                cell,
              )}, which names no type. Write the type in backticks so it can be held to \`${member.type}\`.`,
            );
            continue;
          }

          const compared = comparableTypes(inTicks, member);
          const agrees =
            compared.claimed === compared.declared ||
            expandsStringUnion(compared.claimed, compared.declared, entry.pkg);

          if (excuse !== undefined) {
            usedExceptions.add(key);

            if (agrees) {
              problems.push(
                `${key}: registered in TYPE_CELL_EXCEPTIONS ("${excuse}"), but the cell now matches the declared type exactly. Delete the entry; a stale exception is standing permission for the next value that lands in that cell.`,
              );
            }

            continue;
          }

          typesChecked += 1;

          if (!agrees) {
            problems.push(
              `${key}: documented as \`${inTicks}\`, declared as \`${member.type}\``,
            );
          }
        }
      }
    }

    for (const key of Object.keys(TYPE_CELL_EXCEPTIONS)) {
      if (usedExceptions.has(key)) continue;

      problems.push(
        `${key}: in TYPE_CELL_EXCEPTIONS, but no row of a bound member table documents that member (renamed heading? renamed prop? row deleted?). Delete the entry or re-point it.`,
      );
    }

    expect(
      problems,
      [
        "A docs props table's `Type` column disagrees with the declared type.",
        "",
        "That column is what a reader writes their own signature against: a",
        "`number` documented as a `string` is a compile error the page promised",
        "them they would not get.",
        "",
        ...problems,
        "",
        "Where the difference is deliberate — a bound type argument, an alias",
        "expanded to the values it stands for — register the row in",
        "TYPE_CELL_EXCEPTIONS with a written reason. That is the only escape.",
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);

    // Conditional on the roster, exactly as the optionality floor is, and for
    // the same reason: an empty `problems` is indistinguishable from "read
    // nothing at all". A roster that registers tables and still compares no
    // cell is the vacuous case this file exists to prevent.
    if (Object.values(MEMBER_TABLE_TYPES).some((value) => value === true)) {
      expect(
        typesChecked,
        "not one `Type` cell was compared against a declared type, though " +
          "MEMBER_TABLE_TYPES registers tables that carry one. The report's " +
          "member parse, the table parse, or the cell read is what changed.",
      ).toBeGreaterThan(0);
    }
  });

  test("every string-literal union the docs name is registered in STRING_UNIONS", () => {
    // Fail closed first. The roster below is computed by filtering the reports'
    // unions down to the ones the docs name, so a report parse that finds no
    // unions at all makes the roster empty, the roster test trivially green,
    // and the enumeration check below vacuous.
    const parsed = REPORTED_PACKAGES.flatMap((pkg) => [
      ...report(pkg).unions.keys(),
    ]);

    expect(
      parsed,
      'no `export type X = "a" | "b"` unions parsed out of any ' +
        "packages/*/*.api.md. The reports declare several, so typeAliasBodies or " +
        "stringUnionMembers stopped matching the report's layout and the prose " +
        "enumeration check below is now reading an empty set.",
    ).not.toEqual([]);

    expect(
      namedStringUnions(),
      [
        "A string-literal union named in the docs is not registered in",
        "STRING_UNIONS in this file (or a registered one is no longer named).",
        "",
        "A props table can only print such a union's NAME; its members are",
        "spelled out in prose, and prose is the one shape the table checks above",
        "cannot see. So the roster is closed the same way TABLES is: say whether",
        "a page spells this union out, and the check holds that sentence to the",
        "union — no member omitted, none invented.",
        "",
        "If no page spells it out — a name-drop in a cross-reference list, a",
        "partial sample behind an explicit `…` — register it as",
        '`{ unenumerated: "<why>" }`. That is the only escape and it costs a',
        "written reason. What you may NOT decide is whether your sentence gets",
        "checked.",
      ].join("\n"),
    ).toEqual(Object.keys(STRING_UNIONS).sort());
  });

  test("a union spelled out in prose names exactly its members", () => {
    const problems: string[] = [];
    /** Literals actually compared against a union, for the floor below. */
    let literalsChecked = 0;

    for (const [key, binding] of Object.entries(STRING_UNIONS)) {
      const [pkg, type] = key.split("/") as [string, string];
      const members = report(pkg).unions.get(type);

      if (!members) {
        problems.push(
          `${key}: no longer a string-literal union in ${pkg}.api.md. Either it ` +
            "was retyped (an object, a widened union) or it is gone; delete the " +
            "entry or re-point it.",
        );
        continue;
      }

      const found = PAGES.flatMap((page) => proseEnumerations(page, type));

      if (!isEnumerated(binding)) {
        // A stale excuse is standing permission for whatever sentence lands
        // next: it says "there is nothing here to check", and the moment there
        // is, that sentence goes unchecked under it.
        for (const enumeration of found) {
          problems.push(
            `${key}: excused in STRING_UNIONS ("${binding.unenumerated}"), but ` +
              `${enumeration.page} now spells it out — "${enumeration.sentence}". ` +
              "Bind the entry to that page so the sentence is held to the union, " +
              "or drop the enumeration back to a name-drop.",
          );
        }

        continue;
      }

      const onItsPage = found.filter((entry) => entry.page === binding.page);

      if (onItsPage.length === 0) {
        problems.push(
          `${key}: bound to ${binding.page}, but no sentence there names it in ` +
            "backticks and then quotes a member. The page is where a reader " +
            `learns that ${type} has ${members.length} members, and this check ` +
            "just found nothing to compare. Restore the sentence, or re-point " +
            "the entry at the page that carries it now.",
        );
        continue;
      }

      for (const enumeration of found) {
        const documented = [...new Set(enumeration.literals)].sort();
        const declared = [...members].sort();

        literalsChecked += enumeration.literals.length;

        const missing = declared.filter((name) => !documented.includes(name));
        const invented = documented.filter((name) => !declared.includes(name));

        if (missing.length > 0) {
          problems.push(
            `${enumeration.page}: \`${type}\` is spelled out without ${missing
              .map((name) => `"${name}"`)
              .join(
                ", ",
              )}, which the union declares — "${enumeration.sentence}"`,
          );
        }

        if (invented.length > 0) {
          problems.push(
            `${enumeration.page}: \`${type}\` is spelled out with ${invented
              .map((name) => `"${name}"`)
              .join(
                ", ",
              )}, which the union does not have — "${enumeration.sentence}"`,
          );
        }
      }
    }

    expect(
      problems,
      [
        "A docs sentence enumerating a string-literal union disagrees with the",
        "union. The sentence IS the reader's list of legal values: an omitted",
        "member is a value they never learn about, and an invented one is a",
        "value that fails to typecheck the moment they use it.",
        "",
        ...problems,
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);

    // Conditional on the roster, exactly as the optionality floor is: a roster
    // of nothing but excused unions is a legitimate state, and must not force
    // someone to invent a sentence to get green. A roster that BINDS a union
    // and still compares nothing is the vacuous case.
    if (Object.values(STRING_UNIONS).some(isEnumerated)) {
      expect(
        literalsChecked,
        "not one enumerated literal was compared against its union, though " +
          "STRING_UNIONS binds a union to a page. proseEnumerations is reading " +
          "nothing — the sentence shape it looks for, or the fence stripping it " +
          "reads through, is what changed.",
      ).toBeGreaterThan(0);
    }
  });

  test("the tool-panel strings listings name every toolPanel* message key", () => {
    // Fail closed on both inputs before comparing anything. The page not being
    // where this file says it is, or the interface parsing to no toolPanel*
    // members, each turn every assertion below vacuous — the exact silence the
    // listings sat in before this check existed.
    const page = PAGES.find((candidate) => candidate.rel === TOOL_PANEL_PAGE);

    if (!page) {
      throw new Error(
        `${TOOL_PANEL_PAGE} is gone. It is the page whose sections list the ` +
          "tool panel's message keys; if it was renamed, re-point this check.",
      );
    }

    const declared = (report("react").members.get(MESSAGES_INTERFACE) ?? [])
      .map((member) => member.name)
      .filter((name) => name.startsWith("toolPanel"));

    expect(
      declared.length,
      `${MESSAGES_INTERFACE} in react.api.md parsed to zero toolPanel* ` +
        "members. The interface declares dozens, so MEMBER_RE stopped " +
        "matching its layout — or the messages surface moved to another " +
        "interface — and this check is reading an empty set.",
    ).toBeGreaterThan(0);

    // The roster is computed-complete against the report, both ways: a new
    // toolPanel* message key forces an entry, and a deleted one fails as
    // stale. This is what keeps the roster from lazily shrinking to match
    // whatever the prose happens to still say.
    expect(
      [...declared].sort(),
      [
        `The toolPanel* members of ${MESSAGES_INTERFACE} and the`,
        "TOOL_PANEL_MESSAGE_KEYS roster in this file disagree.",
        "",
        "A new message key is owed a mention in the owning section's strings",
        `paragraph on ${TOOL_PANEL_PAGE} AND an entry in the roster — add both`,
        "in the same change. A key the interface no longer declares leaves a",
        "stale entry behind: delete it, and the prose mention with it.",
        "",
        "If the key genuinely has no listing to appear in, register it",
        '`{ unlisted: "<why>" }`. That is the only escape and it costs a',
        "written reason. What you may NOT decide is whether your key gets",
        "checked.",
      ].join("\n"),
    ).toEqual(Object.keys(TOOL_PANEL_MESSAGE_KEYS).sort());

    const problems: string[] = [];
    const pageProse = withoutFences(page.raw);
    const collapse = (text: string): string => text.replace(/\s+/g, " ");
    /** Keys actually held to a listing, for the floor below. */
    let mentionsChecked = 0;

    for (const [key, binding] of Object.entries(TOOL_PANEL_MESSAGE_KEYS)) {
      if (!isListed(binding)) {
        // A stale excuse is standing permission for the next drift: it says
        // "nothing here to check", and the moment the page names the key,
        // that mention goes unchecked under it.
        if (namesKey(pageProse, key)) {
          problems.push(
            `\`${key}\`: excused as unlisted ("${binding.unlisted}"), but ` +
              `${TOOL_PANEL_PAGE} now names it. Bind the entry to the ` +
              "section that carries it, so the mention is held to the report.",
          );
        }

        continue;
      }

      const prose = sectionProse(page, binding.section);

      if (prose === undefined) {
        problems.push(
          `\`${key}\`: bound to the "${binding.section}" section, but ` +
            `${TOOL_PANEL_PAGE} has no \`## ${binding.section}\` heading. ` +
            "A renamed heading takes every key bound to it out of this " +
            "check; re-point the roster at the heading's new text.",
        );
        continue;
      }

      mentionsChecked += 1;

      if (binding.via === undefined) {
        if (!namesKey(prose, key)) {
          problems.push(
            `\`${key}\`: not named in the "${binding.section}" section of ` +
              `${TOOL_PANEL_PAGE}. That section's strings listing is where a ` +
              "reader learns the key exists — name it there (backticked), or " +
              "if the listing now covers it through a phrase, record the " +
              "phrase as the roster entry's `via`.",
          );
        }

        continue;
      }

      // A `via` phrase stands in for the bare key, so it is held two ways: it
      // must still be in the section, and a wildcard phrase must actually
      // cover the key it is claimed for.
      const wildcard = /^`(toolPanel[A-Za-z0-9]*)\*`$/.exec(binding.via);

      if (wildcard && !key.startsWith(wildcard[1] as string)) {
        problems.push(
          `\`${key}\`: bound via the wildcard ${binding.via}, which does not ` +
            "cover that name. The entry is wrong — name the key in the " +
            "section, or fix the binding.",
        );
        continue;
      }

      if (!collapse(prose).includes(collapse(binding.via))) {
        problems.push(
          `\`${key}\`: rides the phrase ${JSON.stringify(binding.via)} in the ` +
            `"${binding.section}" section, and that phrase is no longer ` +
            "there. Rewording the sentence retired the coverage it carried: " +
            "name the key outright, or update the roster's `via` to the " +
            "sentence's new wording.",
        );
        continue;
      }

      if (namesKey(prose, key)) {
        problems.push(
          `\`${key}\`: bound via ${JSON.stringify(binding.via)}, but the ` +
            `"${binding.section}" section now names it outright. Drop the ` +
            "`via` so the mention itself is what is checked; a stale `via` " +
            "is standing permission to delete the name again.",
        );
      }
    }

    // The other direction: a key the docs invent. The Pretable-prefixed-type
    // sweep above cannot see these — message keys are camelCase, not
    // `Pretable*` — so a listing naming a key the interface does not declare
    // sent the reader to override a message that does not exist. Swept over
    // every page: a mention is wrong wherever it is written. The wildcard
    // phrase does not match (its `*` is not an identifier character), and
    // neither does the bare `toolPanel` prop.
    const known = new Set(declared);

    for (const candidate of PAGES) {
      for (const match of withoutFences(candidate.raw).matchAll(
        /`(toolPanel[A-Z][A-Za-z0-9]*)`/g,
      )) {
        const name = match[1] as string;

        if (!known.has(name)) {
          problems.push(
            `${candidate.rel}: names \`${name}\`, which ${MESSAGES_INTERFACE} ` +
              "does not declare. A reader who writes it into `messages` gets " +
              "a key the grid never reads.",
          );
        }
      }
    }

    expect(
      problems,
      [
        "A tool-panel strings listing disagrees with the message keys",
        `${MESSAGES_INTERFACE} declares.`,
        "",
        "Those paragraphs are the reader's list of what `messages` can",
        "localize: a key omitted from them is a string nobody learns they can",
        "override, and one invented is an override the grid never reads.",
        "",
        ...problems,
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);

    // The floor, guarded on the roster binding anything at all — exactly as
    // the optionality and union floors are, and for the same reason: an empty
    // `problems` over sections that resolved to nothing is the vacuous green
    // this file exists to prevent.
    if (Object.values(TOOL_PANEL_MESSAGE_KEYS).some(isListed)) {
      expect(
        mentionsChecked,
        "not one message key was held to a section's listing, though " +
          "TOOL_PANEL_MESSAGE_KEYS binds keys to sections. sectionProse is " +
          "reading nothing — the heading shape, or the fence stripping it " +
          "reads through, is what changed.",
      ).toBeGreaterThan(0);
    }
  });

  test("every fence fixture names the fences it transcribes", () => {
    // Fail closed. Every check below is scoped to the fixtures that exist and
    // the markers in them, so a moved directory or a marker syntax this file no
    // longer recognises makes all of it vacuous — and a vacuous version of this
    // check is precisely the state it was written to end: the fixtures compiled
    // and were bound to nothing at all.
    expect(
      fs.existsSync(FIXTURE_DIR),
      `no fixture directory at ${path.relative(REPO_ROOT, FIXTURE_DIR)}. The ` +
        "compile-time fixtures for the docs fences live there; if they moved, " +
        "re-point this check.",
    ).toBe(true);

    const fixtures = fs
      .readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith(FIXTURE_SUFFIX));

    expect(
      fixtures.sort(),
      [
        `The fixtures in ${path.relative(REPO_ROOT, FIXTURE_DIR)} are not the`,
        "ones FIXTURE_FILES names.",
        "",
        "A deleted fixture takes its page's fences out of every check below with",
        "it — nothing then names them, so the page stops being one this file",
        "watches, silently. If a page was rewritten and its fixture is genuinely",
        "gone, delete the entry here deliberately; if a fixture was added, name",
        "it here, which is the registration every roster in this file charges.",
      ].join("\n"),
    ).toEqual([...FIXTURE_FILES].sort());

    const problems: string[] = [];

    // A fixture with no marker at all: it compiles, and it says nothing about
    // what it compiles ON BEHALF OF. That is the whole defect being closed —
    // both fixtures were hand transcriptions bound to nothing, so rewording,
    // re-fencing or deleting a snippet left them happily compiling stale code.
    for (const region of FIXTURE_REGIONS) {
      if (region.fence !== "") continue;

      problems.push(
        `${region.fixture}: no \`// docs-fence: <page>#<heading>\` marker. A fixture that names no fence proves that ITS code compiles and nothing about the docs.`,
      );
    }

    const fenceKeys = new Set(ALL_FENCES.map((fence) => fence.key));

    for (const region of FIXTURE_REGIONS) {
      if (region.fence === "" || fenceKeys.has(region.fence)) continue;

      problems.push(
        `${region.fixture}: marker names \`${region.fence}\`, which is not a fence in the docs. The heading was renamed, the page moved, or the fence was deleted — in which case delete or re-point the region rather than leaving it to compile on its own.`,
      );
    }

    const claimed = new Map<string, string[]>();

    for (const region of FIXTURE_REGIONS) {
      if (region.fence === "") continue;

      claimed.set(region.fence, [
        ...(claimed.get(region.fence) ?? []),
        region.fixture,
      ]);
    }

    for (const [fence, fixtures2] of claimed) {
      if (fixtures2.length < 2) continue;

      problems.push(
        `${fence}: transcribed by ${fixtures2.join(" and ")}. Two fixtures for one fence means neither is the one that has to be updated when it changes.`,
      );
    }

    const bound = fixtureBoundPages();
    const excused = new Set(Object.keys(UNTRANSCRIBED_FENCES));

    for (const fence of ALL_FENCES) {
      if (!bound.has(fence.page)) continue;
      if (claimed.has(fence.key)) {
        if (excused.has(fence.key)) {
          problems.push(
            `${fence.key}: registered in UNTRANSCRIBED_FENCES ("${UNTRANSCRIBED_FENCES[fence.key]}"), but a fixture now transcribes it. Delete the entry.`,
          );
        }

        continue;
      }

      if (excused.has(fence.key)) continue;

      problems.push(
        `${fence.key}: on a page a fixture transcribes, but no fixture region names it and it is not in UNTRANSCRIBED_FENCES. A ${fence.info || "code"} snippet on a page whose OTHER snippets are proven to compile reads as proven too.`,
      );
    }

    for (const key of excused) {
      if (fenceKeys.has(key)) continue;

      problems.push(
        `${key}: in UNTRANSCRIBED_FENCES, but no such fence exists. A stale excuse is standing permission for whatever fence lands on that heading next.`,
      );
    }

    expect(
      problems,
      [
        "A compile-time fixture and the docs fences disagree about what is",
        "being transcribed.",
        "",
        ...problems,
        "",
        "`apps/website/app/docs/__tests__/*.types.tsx` exist to prove that the",
        "snippets on a page compile. Until each one named the fence it copies,",
        "nothing tied the two together: a reworded, re-fenced or deleted snippet",
        "left the fixture compiling code no page shows any more, and the suite",
        "green either way.",
      ].join("\n"),
    ).toEqual([]);
  });

  test("every fence a fixture names is reproduced in that fixture", () => {
    const problems: string[] = [];
    /** Fence tokens actually matched, for the floor below. */
    let tokensChecked = 0;
    const renamesUsed = new Set<string>();

    for (const region of FIXTURE_REGIONS) {
      const fence = ALL_FENCES.find((entry) => entry.key === region.fence);

      // Reported by the registration test above; do not say it twice.
      if (!fence) continue;

      const renames = FENCE_RENAMES[fence.key];
      const raw = codeTokens(fence.body);

      expect(
        raw.length,
        `${fence.key} tokenised to nothing. The fence is not empty, so ` +
          "codeTokens is what changed, and this fence is being compared to " +
          "nothing.",
      ).toBeGreaterThan(0);

      const withoutRenames = subsequenceGap(raw, region.tokens);

      if (renames) {
        renamesUsed.add(fence.key);

        // A rename nobody needs is the easiest place to park a fixture that has
        // quietly stopped matching: it reads as housekeeping, and it rewrites
        // the comparison. So an unnecessary one is a failure, not a tidy-up.
        if (withoutRenames < 0) {
          problems.push(
            `${fence.key}: FENCE_RENAMES maps ${Object.entries(renames)
              .map(([from, to]) => `\`${from}\` → \`${to}\``)
              .join(
                ", ",
              )}, but ${region.fixture} reproduces the fence without any renaming. Delete the entry.`,
          );
          continue;
        }
      }

      const tokens = renames ? renameTokens(raw, renames) : raw;
      const gap = subsequenceGap(tokens, region.tokens);

      if (gap < 0) {
        tokensChecked += tokens.length;
        continue;
      }

      const around = tokens
        .slice(Math.max(0, gap - 4), gap + 5)
        .join(" ")
        .replace(/\s+/g, " ");

      problems.push(
        `${fence.key}: ${region.fixture} does not reproduce it. The fence's token \`${tokens[gap]}\` (in "…${around}…") is not in the fixture region, in that order. Update the fixture to the snippet the page now shows — or, if the snippet is wrong, the page.`,
      );
    }

    for (const key of Object.keys(FENCE_RENAMES)) {
      if (renamesUsed.has(key)) continue;

      problems.push(
        `${key}: in FENCE_RENAMES, but no fixture region transcribes that fence. Delete the entry or re-point it.`,
      );
    }

    expect(
      problems,
      [
        "A docs fence is not reproduced by the fixture that claims to prove it",
        "compiles.",
        "",
        ...problems,
        "",
        "The fixture may add whatever a partial snippet needs in order to",
        "compile — merged imports, the rows it assumes, a `return` around bare",
        "JSX — but it must contain everything the fence shows, in order. A",
        "reader pastes the fence, not the fixture.",
      ].join("\n"),
    ).toEqual([]);

    // A floor, not a drift detector: `problems` being empty is what a broken
    // tokenizer, a broken fence extraction and a correct corpus all look like.
    expect(
      tokensChecked,
      "not one fence token was matched against a fixture, though the fixtures " +
        "name fences to transcribe. FENCE_RE, codeTokens or the region reader " +
        "is what changed, and this check just compared nothing.",
    ).toBeGreaterThan(0);
  });

  test("every discriminant table in the docs is registered in DISCRIMINANT_TABLES", () => {
    // Fail closed first, at both ends. The detector asks whether a first header
    // ends in a discriminant name, and that set is computed from the reports:
    // if the alias reader stops parsing object unions, the set empties, no
    // table is detected, the roster below must be empty to match — and the
    // whole check goes green over nothing. That is not hypothetical, it is the
    // state this file shipped in until now.
    const parsed = REPORTED_PACKAGES.flatMap((pkg) => [
      ...report(pkg).discriminatedUnions.keys(),
    ]);

    expect(
      parsed,
      "no discriminated object unions parsed out of any packages/*/*.api.md. " +
        "The reports declare several (PretableRowModelStatus among them), so " +
        "typeAliasBodies or discriminatedUnionOf stopped matching the report's " +
        "layout, and the table check below is reading an empty set.",
    ).not.toEqual([]);

    expect(
      [...knownDiscriminants()],
      "no discriminant names computed from the reports, so discriminantTables " +
        "recognises nothing and every union table in the docs is unwatched.",
    ).not.toEqual([]);

    expect(
      ALL_DISCRIMINANT_TABLES.map((table) => table.key).sort(),
      [
        "A table whose first column is a union's discriminant is not registered",
        "in DISCRIMINANT_TABLES in this file (or a registered one no longer",
        "exists).",
        "",
        "Such a table is not a member table — every row is one ALTERNATIVE of a",
        "union, not a member of an interface — so the member-table roster never",
        "saw it, and `status.kind` sat unchecked in both directions: a kind the",
        "union does not have, a kind it does have and the table forgot, and a",
        "changed carried field were all green.",
        "",
        "Add an entry naming the reported union the table draws, and the check",
        "holds it to that union. If it draws none — an ad-hoc table that happens",
        'to lead with a `kind` column — register it as `{ unbound: "<why>" }`.',
        "That is the only escape and it costs a written reason.",
      ].join("\n"),
    ).toEqual(Object.keys(DISCRIMINANT_TABLES).sort());
  });

  test("a discriminated union drawn as a table matches it, in both directions", () => {
    const problems: string[] = [];
    /** Alternatives actually compared, for the floor below. */
    let alternativesChecked = 0;
    let carriedChecked = 0;

    for (const [key, binding] of Object.entries(DISCRIMINANT_TABLES)) {
      if (!isTabledUnion(binding)) continue;

      const union = boundUnionAlternatives(binding.pkg, binding.type);

      if (!union) {
        problems.push(
          `${key}: "${binding.type}" is no longer a discriminated object union or a ` +
            `string-literal union in ${binding.pkg}.api.md. Either it was retyped or ` +
            "it is gone; re-point the entry or delete it.",
        );
        continue;
      }

      const table = ALL_DISCRIMINANT_TABLES.find(
        (candidate) => candidate.key === key,
      );

      // Belt and braces with the registration test above: read through a
      // `?? undefined` and this whole check is vacuous exactly when the table
      // it protects has gone missing.
      if (!table) {
        problems.push(
          `${key}: bound to ${binding.type}, but no such discriminant table exists. ` +
            "The heading moved, the page moved, or the first header stopped naming " +
            "the discriminant.",
        );
        continue;
      }

      const declared = union.alternatives.map(
        (alternative) => alternative.kind,
      );
      const documented: string[] = [];

      for (const row of table.rows) {
        const cell = (row[0] ?? "").replace(/`/g, "").trim();

        // Reported, never skipped — the lesson of `documentedNames`. A row this
        // file cannot read is a row that documents nothing and is compared
        // against nothing, and a silent skip here would take it out of BOTH
        // directions of the comparison below.
        if (!/^[A-Za-z0-9_$-]+$/.test(cell)) {
          problems.push(
            `${key}: the first cell ${JSON.stringify(cell)} names no discriminant literal, ` +
              `so this row is not checked against ${binding.type} at all. Lead the cell ` +
              "with the bare literal in backticks and put any link or emphasis after it.",
          );
          continue;
        }

        documented.push(cell);
        alternativesChecked += 1;
      }

      const missing = declared.filter((kind) => !documented.includes(kind));
      const invented = documented.filter((kind) => !declared.includes(kind));

      if (missing.length > 0) {
        problems.push(
          `${key}: ${binding.type} declares ${missing
            .map((kind) => `\`${kind}\``)
            .join(", ")}, which the table does not document`,
        );
      }

      if (invented.length > 0) {
        problems.push(
          `${key}: documents ${invented
            .map((kind) => `\`${kind}\``)
            .join(", ")}, which ${binding.type} does not have`,
        );
      }

      const carriesColumns = carriedFieldsColumns(table);

      if (binding.carries !== true) {
        // A stale excuse is standing permission for whatever column lands in
        // this table next — including a real carried-members column.
        if (carriesColumns.length > 0) {
          problems.push(
            `${key}: excused in DISCRIMINANT_TABLES ("${binding.carries}"), but column ${carriesColumns
              .map((index) => `"${table.headers[index] ?? index}"`)
              .join(", ")} now reads as a carried-members list on every row. ` +
              "Register `carries: true` so it is held to the union, or drop the column.",
          );
        }

        continue;
      }

      if (carriesColumns.length === 0) {
        problems.push(
          `${key}: registered \`carries: true\`, but no column lists each alternative's other members on every row — headers are [${table.headers.join(
            " | ",
          )}]. A cell that is neither a dash nor a comma-separated list of backticked ` +
            "names will do it; whichever it is, the carried fields are no longer being checked.",
        );
        continue;
      }

      if (carriesColumns.length > 1) {
        problems.push(
          `${key}: ${carriesColumns.length} columns read as a carried-members list (${carriesColumns
            .map((index) => `"${table.headers[index] ?? index}"`)
            .join(", ")}), so this file cannot tell which one is which.`,
        );
        continue;
      }

      const carriesColumn = carriesColumns[0] as number;

      for (const row of table.rows) {
        const kind = (row[0] ?? "").replace(/`/g, "").trim();
        const alternative = union.alternatives.find(
          (entry) => entry.kind === kind,
        );

        // An invented kind is already reported above; do not say it twice.
        if (!alternative) continue;

        // Compared as sets: the order a table lists carried fields in is
        // editorial, and the report's is declaration order. Neither is wrong.
        const claimed = [...new Set(carriedFields(row[carriesColumn] ?? ""))]
          .sort()
          .join(", ");
        const actual = [...new Set(alternative.carries)].sort().join(", ");

        carriedChecked += 1;

        if (claimed !== actual) {
          problems.push(
            `${key}: \`${kind}\` is documented as carrying ${claimed === "" ? "nothing" : claimed} but ${binding.type} declares ${actual === "" ? "nothing" : actual}`,
          );
        }
      }
    }

    expect(
      problems,
      [
        "A docs table drawing a discriminated union disagrees with the union.",
        "",
        "The table IS the reader's list of legal `kind` values and of what each",
        "one carries: a missing alternative is a state they never handle, an",
        "invented one is a branch that can never run, and a wrong carried field",
        "is a property access that does not typecheck.",
        "",
        ...problems,
        "",
        REMEDY_REGENERATE,
      ].join("\n"),
    ).toEqual([]);

    // Floors, conditional on the roster, exactly as the optionality and prose
    // enumeration floors are. An empty `problems` is indistinguishable from
    // "read nothing at all", which is what breaking the table parse or the
    // alias reader produces.
    if (Object.values(DISCRIMINANT_TABLES).some(isTabledUnion)) {
      expect(
        alternativesChecked,
        "not one documented `kind` was compared against a union, though " +
          "DISCRIMINANT_TABLES binds a table to one. The table parse or the " +
          "first-cell read is what changed, and this check is green over nothing.",
      ).toBeGreaterThan(0);
    }

    if (
      Object.values(DISCRIMINANT_TABLES).some(
        (binding) => isTabledUnion(binding) && binding.carries === true,
      )
    ) {
      expect(
        carriedChecked,
        "not one carried-members cell was compared against its alternative, " +
          "though DISCRIMINANT_TABLES registers a table that carries one. That " +
          "is the half most likely to drift, and it just read nothing.",
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
        "The stylesheet wins: packages/ui/themes/<theme>.css at `:root`.",
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
