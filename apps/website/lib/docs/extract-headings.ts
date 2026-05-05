import GithubSlugger from "github-slugger";

export interface DocsHeading {
  depth: 2 | 3;
  text: string;
  slug: string;
}

const HEADING_RE = /^(#{2,3})\s+(.+?)\s*$/gm;
const FENCE_RE = /^```[\s\S]*?^```/gm;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;

export function extractHeadings(raw: string): DocsHeading[] {
  const stripped = raw.replace(FRONTMATTER_RE, "").replace(FENCE_RE, "");
  const slugger = new GithubSlugger();
  const out: DocsHeading[] = [];
  for (const m of stripped.matchAll(HEADING_RE)) {
    const depth = m[1].length as 2 | 3;
    const text = m[2].replace(/`/g, "");
    out.push({ depth, text, slug: slugger.slug(text) });
  }
  return out;
}
