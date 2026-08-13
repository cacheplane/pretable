/**
 * Every field here must be READ by something. `order?: number` used to sit
 * below `nav` and was consumed nowhere — 39 pages carried a number that did
 * nothing, which is why nobody noticed five of them shared `order: 8`. Sidebar
 * placement comes from `app/docs/_nav.ts` alone.
 */
export interface DocsFrontmatter {
  title: string;
  description: string;
  nav: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isValidSlugSegment(s: string): boolean {
  return SLUG_RE.test(s);
}

const ROOT_INDEX = "getting-started/index.mdx";

export function slugToContentPath(slug: string[]): string {
  if (slug.length === 0) return ROOT_INDEX;
  for (const seg of slug) {
    if (!isValidSlugSegment(seg)) {
      throw new Error(`Invalid slug segment: ${seg}`);
    }
  }
  if (slug.length === 1) return `${slug[0]}/index.mdx`;
  return slug.join("/") + ".mdx";
}

export function contentPathToSlug(p: string): string[] {
  const noExt = p.replace(/\.mdx$/, "");
  const parts = noExt.split("/").filter(Boolean);
  if (parts[parts.length - 1] === "index") parts.pop();
  if (parts.length === 1 && parts[0] === "getting-started") return [];
  return parts;
}
