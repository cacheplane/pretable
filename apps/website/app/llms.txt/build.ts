import path from "node:path";

import { enumerateDocs, type DocsPageEntry } from "../../lib/docs/enumerate";
import type { DocsNavSection } from "../docs/_nav";

export async function buildLlmsTxt(
  root: string,
  nav: DocsNavSection[],
): Promise<string> {
  const pages = await enumerateDocs(root);

  // Resolve each nav href to a FILE, not to a canonical slug.
  //
  // A slug-keyed map silently dropped the docs landing page: `contentPathToSlug`
  // maps `getting-started/index.mdx` to the empty slug, so its canonical URL is
  // `/docs`, while the sidebar lists it as `/docs/getting-started`. One page,
  // two URLs, and `bySlug.get()` missed on the one the nav actually uses — so
  // the first entry in the sidebar was absent from this file entirely.
  //
  // The two candidates mirror `resolveFile` in `lib/docs/load.ts`, which is
  // what decides the page a URL renders.
  const byFile = new Map(pages.map((p) => [p.filePath, p]));
  const resolve = (href: string): DocsPageEntry | undefined => {
    const slug = href
      .replace(/^\/docs\/?/, "")
      .split("/")
      .filter(Boolean);
    const base = slug.length === 0 ? "getting-started" : slug.join("/");

    return (
      byFile.get(path.join(root, `${base}.mdx`)) ??
      byFile.get(path.join(root, base, "index.mdx"))
    );
  };
  const lines: string[] = [
    "# Pretable Docs",
    "",
    "> The drop-in React data grid built for streaming.",
    "",
  ];
  for (const group of nav) {
    lines.push(`## ${group.title}`);
    for (const item of group.items) {
      const page = resolve(item.href);

      // Not `continue`. A nav entry that resolves to nothing is a broken
      // sidebar link, and skipping it published a docs index that was quietly
      // missing a page for as long as nobody counted the lines.
      if (!page) {
        throw new Error(
          `app/docs/_nav.ts lists "${item.href}", which resolves to no page ` +
            `under ${root}. Fix the href or remove the entry; llms.txt will ` +
            "not silently omit it.",
        );
      }

      lines.push(
        `- [${page.frontmatter.title}](${item.href}.md): ${page.frontmatter.description}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
