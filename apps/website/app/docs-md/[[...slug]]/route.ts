import { notFound } from "next/navigation";

import { loadDocsPage } from "../../../lib/docs/load";
import { buildRawMarkdownResponse } from "../../../lib/docs/raw-response";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug = [] } = await params;
  let result;
  try {
    result = await loadDocsPage(slug);
  } catch {
    notFound();
  }
  return buildRawMarkdownResponse({
    frontmatter: result.frontmatter,
    raw: result.raw,
  });
}
