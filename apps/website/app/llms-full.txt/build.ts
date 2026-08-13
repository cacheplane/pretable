import fs from "node:fs/promises";

import { enumerateDocs } from "../../lib/docs/enumerate";
import { expandDocsBody } from "../../lib/docs/examples/expand";

export async function buildLlmsFullTxt(root: string): Promise<string> {
  const pages = await enumerateDocs(root);
  const sections: string[] = [];
  for (const p of pages) {
    const raw = await fs.readFile(p.filePath, "utf8");
    const body = await expandDocsBody(raw, p.filePath);
    sections.push(
      `# ${p.frontmatter.title}\n\n${p.frontmatter.description}\n\n${body}`,
    );
  }
  return sections.join("\n\n---\n\n");
}
