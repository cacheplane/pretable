import { expandExamples } from "./examples/expand";
import type { DocsFrontmatter } from "./paths";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

export async function buildRawMarkdownResponse(args: {
  frontmatter: DocsFrontmatter;
  raw: string;
}): Promise<Response> {
  const stripped = args.raw.replace(FRONTMATTER_RE, "");
  const body = await expandExamples(stripped);
  const text = `# ${args.frontmatter.title}\n\n${args.frontmatter.description}\n\n${body}`;
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
