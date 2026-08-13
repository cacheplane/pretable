import { enumerateDocs } from "../../lib/docs/enumerate";
import { exampleRegistry } from "../../lib/docs/examples/registry.generated";
import { exampleCatalogLine } from "../../lib/docs/examples/serialize";
import type { DocsNavSection } from "../docs/_nav";

export async function buildLlmsTxt(
  root: string,
  nav: DocsNavSection[],
): Promise<string> {
  const pages = await enumerateDocs(root);
  const bySlug = new Map(
    pages.map((p) => [
      "/docs" + (p.slug.length ? "/" + p.slug.join("/") : ""),
      p,
    ]),
  );
  const lines: string[] = [
    "# Pretable Docs",
    "",
    "> The drop-in React data grid built for streaming.",
    "",
  ];
  for (const group of nav) {
    lines.push(`## ${group.title}`);
    for (const item of group.items) {
      const page = bySlug.get(item.href);
      if (!page) continue;
      lines.push(
        `- [${page.frontmatter.title}](${item.href}.md): ${page.frontmatter.description}`,
      );
    }
    lines.push("");
  }
  const exampleIds = Object.keys(exampleRegistry) as Array<
    keyof typeof exampleRegistry
  >;
  if (exampleIds.length > 0) {
    lines.push("## Examples");
    for (const id of exampleIds) {
      lines.push(exampleCatalogLine(id, exampleRegistry[id].meta));
    }
    lines.push("");
  }
  return lines.join("\n");
}
