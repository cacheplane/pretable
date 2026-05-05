import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import { contentPathToSlug, type DocsFrontmatter } from "./paths";

export interface DocsPageEntry {
  slug: string[];
  filePath: string;
  frontmatter: DocsFrontmatter;
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, acc);
    else if (e.isFile() && full.endsWith(".mdx")) acc.push(full);
  }
  return acc;
}

export async function enumerateDocs(root: string): Promise<DocsPageEntry[]> {
  const files = await walk(root);
  const out: DocsPageEntry[] = [];
  for (const f of files) {
    const raw = await fs.readFile(f, "utf8");
    const { data } = matter(raw);
    const rel = path.relative(root, f);
    out.push({
      slug: contentPathToSlug(rel),
      filePath: f,
      frontmatter: data as DocsFrontmatter,
    });
  }
  out.sort((a, b) => a.slug.join("/").localeCompare(b.slug.join("/")));
  return out;
}
