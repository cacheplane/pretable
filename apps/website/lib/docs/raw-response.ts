import { expandDocsBody } from "./examples/expand";
import type { DocsFrontmatter } from "./paths";

export async function buildRawMarkdownResponse(args: {
  frontmatter: DocsFrontmatter;
  raw: string;
}): Promise<Response> {
  const body = await expandDocsBody(args.raw, args.frontmatter.title);
  const text = `# ${args.frontmatter.title}\n\n${args.frontmatter.description}\n\n${body}`;
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
