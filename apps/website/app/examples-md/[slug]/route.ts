import { notFound } from "next/navigation";

import { loadExample, isExampleId } from "../../../lib/docs/examples/registry";
import { exampleRegistry } from "../../../lib/docs/examples/registry.generated";
import { toMarkdown } from "../../../lib/docs/examples/serialize";

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(exampleRegistry).map((slug) => ({ slug }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isExampleId(slug)) notFound();
  const example = await loadExample(slug);
  return new Response(toMarkdown(example, { headingLevel: 1 }), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
