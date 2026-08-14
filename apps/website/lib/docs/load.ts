import fs from "node:fs/promises";
import path from "node:path";

import { compileMDX } from "next-mdx-remote/rsc";
import { cache } from "react";
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

/**
 * Compile one docs page. Memoised for the life of a single request.
 *
 * `/docs/[[...slug]]` loads the same page TWICE per request — once in
 * `generateMetadata` and once in the body — and each load is an MDX compile
 * plus a shiki highlight pass, the most expensive work the route does. Without
 * this the second call repeats all of it to produce a value the first already
 * had.
 *
 * Keyed on the joined slug rather than on the array, because `cache()`
 * memoises on argument IDENTITY: the two call sites derive their own arrays
 * from `params`, so a cache keyed on `slug` would miss every time and quietly
 * do nothing — the failure mode where the fix looks applied and isn't.
 *
 * `cache()` is per-request, not a persistent cache, so an edited MDX file is
 * still picked up on the next request.
 */
export function loadDocsPage(
  slug: string[],
  opts: LoadOptions = {},
): Promise<LoadResult> {
  return loadDocsPageCached(slug.join("/"), opts.root ?? DEFAULT_ROOT);
}

const loadDocsPageCached = cache(
  (slugKey: string, root: string): Promise<LoadResult> =>
    compileDocsPage(slugKey === "" ? [] : slugKey.split("/"), { root }),
);

async function compileDocsPage(
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
