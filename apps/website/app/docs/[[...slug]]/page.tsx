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
        />
        {result.content}
      </article>
    </DocsShell>
  );
}
