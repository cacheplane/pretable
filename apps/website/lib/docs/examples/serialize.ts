import type { ExampleMeta, LoadedExample } from "./define";
import { exampleCanonicalUrl, examplePath } from "./urls";

export interface ToMarkdownOptions {
  /**
   * Heading level for the `Example: <title>` line. Defaults to 3, which is
   * correct when this markdown is spliced into a docs page that already
   * opens with a `# title` (inline expansion, Task 8) — the example heading
   * should sit a level below the page's own.
   *
   * Two call sites override it to `1` instead, and for the same reason:
   * each hands out this markdown as a whole document in its own right, not
   * a fragment spliced into a page. The per-example standalone route
   * (Task 9) serves it as `/examples/<id>.md`; `Example.tsx`'s "Copy for
   * agent" button puts the identical bundle on the clipboard for pasting
   * into an agent chat, where it's likewise read as its own document rather
   * than as a piece of the docs page it was copied from. Keeping both at
   * `1` means two adjacent controls for the same example — the "Copy for
   * agent" button and the `.md` link beside it — never disagree about the
   * example's root heading level.
   *
   * This heading exists only in the markdown serialization — the React
   * shell renders the title in a `div`, and the page's table of contents is
   * extracted from pre-expansion MDX — so its level is purely a boundary
   * marker for agents, which is why callers choose it rather than it being
   * fixed.
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
