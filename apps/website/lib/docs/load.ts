import fs from "node:fs/promises";
import path from "node:path";

import { compileMDX } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { docsMdxComponents } from "../../app/components/docs/MdxRenderer";
import { extractHeadings, type DocsHeading } from "./extract-headings";
import type { DocsFrontmatter } from "./paths";

const DEFAULT_ROOT = path.join(process.cwd(), "content/docs");

export interface LoadOptions {
  root?: string;
}

export interface LoadResult {
  content: React.ReactElement;
  frontmatter: DocsFrontmatter;
  raw: string;
  headings: DocsHeading[];
}

async function resolveFile(root: string, slug: string[]): Promise<string> {
  const base = slug.length === 0 ? "getting-started" : slug.join("/");
  const candidates = [
    path.join(root, `${base}.mdx`),
    path.join(root, base, "index.mdx"),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try next candidate
    }
  }
  throw new Error(`Docs page not found for slug: ${slug.join("/")}`);
}

export async function loadDocsPage(
  slug: string[],
  opts: LoadOptions = {},
): Promise<LoadResult> {
  const root = opts.root ?? DEFAULT_ROOT;
  const file = await resolveFile(root, slug);
  const raw = await fs.readFile(file, "utf8");
  const { content, frontmatter } = await compileMDX<DocsFrontmatter>({
    source: raw,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypePrettyCode, { theme: "github-light" }],
        ],
      },
    },
    components: docsMdxComponents,
  });
  return { content, frontmatter, raw, headings: extractHeadings(raw) };
}
