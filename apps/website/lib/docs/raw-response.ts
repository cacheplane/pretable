import type { DocsFrontmatter } from "./paths";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

export function buildRawMarkdownResponse(args: {
  frontmatter: DocsFrontmatter;
  raw: string;
}): Response {
  const body = args.raw.replace(FRONTMATTER_RE, "");
  const text = `# ${args.frontmatter.title}\n\n${args.frontmatter.description}\n\n${body}`;
  return new Response(text, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
