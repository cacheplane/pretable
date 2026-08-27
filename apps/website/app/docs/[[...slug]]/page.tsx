import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadDocsPage } from "../../../lib/docs/load";
import { resolvePrevNext } from "../../../lib/docs/prev-next";
import { JsonLd } from "../../../lib/seo/JsonLd";
import {
  buildBreadcrumbSchema,
  buildPageSchema,
  resolvePageMetadata,
  type PageDescriptor,
} from "../../../lib/seo/page";
import { getDocsBreadcrumbItems } from "../../components/docs/DocsBreadcrumb";
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
  return slug.length ? `/docs/${slug.join("/")}` : "/docs/getting-started";
}

function docsDescriptor({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}): PageDescriptor {
  return {
    title: `${title} — Pretable`,
    description,
    canonicalPath: path,
    schemaHeadline: title,
    kind: "techArticle",
    markdownAlternate: `${path}.md`,
    breadcrumb: getDocsBreadcrumbItems({ path, title }),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const path = pathFor(slug);
  let result;
  try {
    result = await loadDocsPage(slug);
  } catch {
    // page not found; metadata falls back to defaults — page itself will 404
    return {
      ...resolvePageMetadata({
        title: "Pretable Docs",
        description: "The drop-in React data grid built for streaming.",
        canonicalPath: path,
        schemaHeadline: "Pretable Docs",
        kind: "techArticle",
        markdownAlternate: `${path}.md`,
      }),
      other: { "x-llms-txt": "/llms.txt" },
    };
  }

  return {
    ...resolvePageMetadata(
      docsDescriptor({
        path,
        title: result.frontmatter.title,
        description: result.frontmatter.description,
      }),
    ),
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
  const descriptor = docsDescriptor({
    path,
    title: result.frontmatter.title,
    description: result.frontmatter.description,
  });
  const breadcrumbSchema = buildBreadcrumbSchema(descriptor);
  return (
    <DocsShell
      sidebar={<DocsSidebar />}
      toc={<DocsTOC headings={result.headings} />}
    >
      <JsonLd data={buildPageSchema(descriptor)} />
      {breadcrumbSchema ? <JsonLd data={breadcrumbSchema} /> : null}
      <article className="docs-prose">
        <DocsPageHeader
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
