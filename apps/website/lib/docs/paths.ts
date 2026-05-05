export interface DocsFrontmatter {
  title: string;
  description: string;
  nav: string;
  order?: number;
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
