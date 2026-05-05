import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadDocsPage } from "../../../lib/docs/load";
import { buildRawMarkdownResponse } from "../../../lib/docs/raw-response";
import { DocsPageHeader } from "../../components/docs/DocsPageHeader";
import { DocsShell } from "../../components/docs/DocsShell";
import { DocsSidebar } from "../../components/docs/DocsSidebar";
import { DocsTOC } from "../../components/docs/DocsTOC";

interface Params {
  slug?: string[];
}

interface Search {
  format?: string;
}

function pathFor(slug: string[]): string {
  return "/docs" + (slug.length ? "/" + slug.join("/") : "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const path = pathFor(slug);
  return {
    alternates: { types: { "text/markdown": `${path}.md` } },
    other: { "x-llms-txt": "/llms.txt" },
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { slug = [] } = await params;
  const { format } = await searchParams;
  let result;
  try {
    result = await loadDocsPage(slug);
  } catch {
    notFound();
  }
  if (format === "md") {
    return buildRawMarkdownResponse({
      frontmatter: result.frontmatter,
      raw: result.raw,
    });
  }
  const path = pathFor(slug);
  return (
    <DocsShell
      sidebar={<DocsSidebar />}
      toc={<DocsTOC headings={result.headings} />}
    >
      <article className="docs-prose">
        <DocsPageHeader
          group={result.frontmatter.nav}
          title={result.frontmatter.title}
          description={result.frontmatter.description}
          path={path}
        />
        {result.content}
      </article>
    </DocsShell>
  );
}
