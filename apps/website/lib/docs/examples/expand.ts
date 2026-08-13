import type { LoadedExample } from "./define";
import { isExampleId, loadExample } from "./registry";
import type { ExampleId } from "./registry.generated";
import { toMarkdown } from "./serialize";

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
 */
export async function expandExamples(
  raw: string,
  load: Loader = loadExample,
): Promise<string> {
  const matches = [...raw.matchAll(EXAMPLE_TAG_RE)];
  if (matches.length === 0) {
    return raw;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const tag = match[0];
      const idMatch = ID_ATTR_RE.exec(tag);
      if (!idMatch) {
        throw new Error(
          `<Example> tag is missing a required "id" prop: ${tag}`,
        );
      }
      const id = idMatch[2];
      if (!isExampleId(id)) {
        throw new Error(
          `<Example id="${id}" /> refers to an unknown example id: "${id}"`,
        );
      }
      const example = await load(id);
      return toMarkdown(example);
    }),
  );

  let result = "";
  let cursor = 0;
  matches.forEach((match, i) => {
    const start = match.index ?? 0;
    result += raw.slice(cursor, start) + replacements[i];
    cursor = start + match[0].length;
  });
  result += raw.slice(cursor);
  return result;
}
