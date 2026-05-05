import fs from "node:fs/promises";

import { enumerateDocs } from "./enumerate";
import { extractHeadings } from "./extract-headings";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const FENCE_RE = /```[\s\S]*?```/g;
const TAG_RE = /<[^>]+>/g;

export interface SearchEntry {
  slug: string;
  title: string;
  description: string;
  nav: string;
  headings: string[];
  body: string;
}

export async function buildSearchIndex(root: string): Promise<SearchEntry[]> {
  const pages = await enumerateDocs(root);
  const out: SearchEntry[] = [];
  for (const p of pages) {
    const raw = await fs.readFile(p.filePath, "utf8");
    const body = raw
      .replace(FRONTMATTER_RE, "")
      .replace(FENCE_RE, "")
      .replace(TAG_RE, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
    out.push({
      slug: "/docs" + (p.slug.length ? "/" + p.slug.join("/") : ""),
      title: p.frontmatter.title,
      description: p.frontmatter.description,
      nav: p.frontmatter.nav,
      headings: extractHeadings(raw).map((h) => h.text),
      body,
    });
  }
  return out;
}
