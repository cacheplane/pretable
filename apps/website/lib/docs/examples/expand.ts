import type { LoadedExample } from "./define";
import { isExampleId, loadExample, unknownIdMessage } from "./registry";
import type { ExampleId } from "./registry.generated";
import { toMarkdown } from "./serialize";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

export type Loader = (id: ExampleId) => Promise<LoadedExample>;

/**
 * Matches a whole `<Example ... />` tag, self-closing, props in any order,
 * possibly spanning multiple lines. `[^>]*` already spans newlines (it
 * excludes only `>`), so no `s` flag is needed.
 *
 * Deliberately does NOT special-case a tag that appears inside a fenced
 * code block. Distinguishing "real" tags from ones quoted inside a ``` block
 * would require tracking fence state across the whole document, and no
 * current MDX doc quotes `<Example>` inside a fence to illustrate its own
 * usage — the two real occurrences (grouping.mdx, headless/getting-started.mdx)
 * are both live, unfenced tags. Adding fence-awareness now would be
 * speculative complexity for a case that doesn't exist yet.
 */
const EXAMPLE_TAG_RE = /<Example\b[^>]*\/>/g;
const ID_ATTR_RE = /\bid\s*=\s*(["'])(.*?)\1/;

/**
 * Replaces every `<Example id="..." />` tag in a raw MDX string with the
 * full markdown bundle (`toMarkdown`) for that example — heading,
 * description, Source line, and every file's fenced source. This is what
 * lets an agent fetching raw docs markdown (`/docs/<slug>.md`,
 * `llms-full.txt`) actually see the code a page is teaching, instead of a
 * bare JSX tag.
 *
 * A document with no `<Example>` tags is returned unchanged, without
 * calling `load` at all.
 *
 * `source`, when given, is folded into any thrown error so a build failure
 * names the document that has the bad tag (a docs slug/title, or an MDX
 * `filePath`) rather than leaving the developer to grep the corpus for the
 * offending id.
 */
export async function expandExamples(
  raw: string,
  load: Loader = loadExample,
  source?: string,
): Promise<string> {
  const matches = [...raw.matchAll(EXAMPLE_TAG_RE)];
  if (matches.length === 0) {
    return raw;
  }
  const where = source ? ` (found in ${source})` : "";

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const tag = match[0];
      const idMatch = ID_ATTR_RE.exec(tag);
      if (!idMatch) {
        throw new Error(
          `<Example> tag is missing a required "id" prop: ${tag}${where}`,
        );
      }
      const id = idMatch[2];
      if (!isExampleId(id)) {
        // Reuses registry.ts's diagnostic (registered ids + the
        // `pnpm examples:gen` fix) directly: `loadExample` never runs on
        // this path, since `id` fails the `ExampleId` narrowing it requires,
        // so that message would otherwise be dead code here.
        throw new Error(`${unknownIdMessage(id)}${where}`);
      }
      const example = await load(id);
      return toMarkdown(example);
    }),
  );

  let result = "";
  let cursor = 0;
  matches.forEach((match, i) => {
    // matchAll always sets `index` on every match it yields — unlike a bare
    // `RegExp.exec` loop, there's no path here where it's undefined. A
    // fallback of `0` would rewind the cursor and silently duplicate content
    // instead of surfacing the impossible case, so assert instead.
    const start = match.index!;
    result += raw.slice(cursor, start) + replacements[i];
    cursor = start + match[0].length;
  });
  result += raw.slice(cursor);
  return result;
}

/**
 * The composed unit every raw-markdown surface actually needs: strip the
 * MDX frontmatter block, then expand `<Example>` tags in what's left.
 * `raw-response.ts` (single doc page) and `llms-full.txt/build.ts` (every
 * page) both did this as two separate steps with their own copy of
 * `FRONTMATTER_RE`; extracted here so the pairing — and the regex — can't
 * drift between them.
 */
export async function expandDocsBody(
  raw: string,
  source: string,
  load?: Loader,
): Promise<string> {
  const stripped = raw.replace(FRONTMATTER_RE, "");
  return expandExamples(stripped, load, source);
}
