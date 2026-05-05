import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadDocsPage } from "../../../lib/docs/load";
import { resolvePrevNext } from "../../../lib/docs/prev-next";
import { DocsPageHeader } from "../../components/docs/DocsPageHeader";
import { DocsPrevNext } from "../../components/docs/DocsPrevNext";
import { DocsShell } from "../../components/docs/DocsShell";
import { DocsSidebar } from "../../components/docs/DocsSidebar";
import { DocsTOC } from "../../components/docs/DocsTOC";
import { docsNav } from "../_nav";

interface Params {
  slug?: string[];
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

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug = [] } = await params;
  let result;
  try {
    result = await loadDocsPage(slug);
  } catch {
    notFound();
  }
  const path = pathFor(slug);
  const { prev, next } = resolvePrevNext(path, docsNav);
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
        <DocsPrevNext prev={prev} next={next} />
      </article>
    </DocsShell>
  );
}
