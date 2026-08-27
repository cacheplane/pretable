import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getDocsBreadcrumbItems } from "../../../app/components/docs/DocsBreadcrumb";
import { JsonLd } from "../JsonLd";
import {
  buildBreadcrumbSchema,
  buildPageSchema,
  buildSiteSchema,
  OG_IMAGE_URL,
  resolvePageMetadata,
  type PageDescriptor,
} from "../page";

const home: PageDescriptor = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
  canonicalPath: "/",
  schemaHeadline: "Pretable",
  kind: "webPage",
};

const bench: PageDescriptor = {
  title: "Bench results — pretable",
  description: "Evidence from the Pretable benchmark harness.",
  canonicalPath: "/bench",
  schemaHeadline: "Bench results",
  kind: "webPage",
};

const docs: PageDescriptor = {
  title: "Filtering — Pretable",
  description: "Filter Pretable rows with controlled column state.",
  canonicalPath: "/docs/grid/filtering",
  schemaHeadline: "Filtering",
  kind: "techArticle",
  markdownAlternate: "/docs/grid/filtering.md",
  breadcrumb: getDocsBreadcrumbItems({
    path: "/docs/grid/filtering",
    title: "Filtering",
  }),
};

describe("resolvePageMetadata", () => {
  it.each([home, bench, docs])(
    "resolves absolute canonical and social metadata for $canonicalPath",
    (descriptor) => {
      const metadata = resolvePageMetadata(descriptor);

      expect(metadata.alternates?.canonical).toBe(
        `https://pretable.ai${descriptor.canonicalPath}`,
      );
      expect(metadata.openGraph?.url).toBe(
        `https://pretable.ai${descriptor.canonicalPath}`,
      );
      expect(metadata.openGraph?.images).toEqual([
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: "Pretable",
        },
      ]);
      expect(metadata.twitter).toMatchObject({
        card: "summary_large_image",
        images: [OG_IMAGE_URL],
      });
    },
  );

  it("preserves the absolute markdown alternate for docs", () => {
    expect(resolvePageMetadata(docs).alternates?.types).toEqual({
      "text/markdown": "https://pretable.ai/docs/grid/filtering.md",
    });
  });

  it.each([home, bench, docs])(
    "uses one exact description across every page surface for $canonicalPath",
    (descriptor) => {
      const metadata = resolvePageMetadata(descriptor);
      const pageSchema = buildPageSchema(descriptor);

      expect(metadata.description).toBe(descriptor.description);
      expect(metadata.openGraph?.description).toBe(descriptor.description);
      expect(metadata.twitter?.description).toBe(descriptor.description);
      expect(pageSchema.description).toBe(descriptor.description);
    },
  );
});

describe("structured data", () => {
  it("builds WebPage schemas for the homepage and bench", () => {
    expect(buildPageSchema(home)["@type"]).toBe("WebPage");
    expect(buildPageSchema(bench)["@type"]).toBe("WebPage");
  });

  it("builds a TechArticle and ordered BreadcrumbList for docs", () => {
    const pageSchema = buildPageSchema(docs);
    const breadcrumbSchema = buildBreadcrumbSchema(docs);

    expect(pageSchema["@type"]).toBe("TechArticle");
    expect(pageSchema.headline).toBe("Filtering");
    expect(breadcrumbSchema).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Grid",
          item: "https://pretable.ai/docs/grid",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Filtering",
          item: "https://pretable.ai/docs/grid/filtering",
        },
      ],
    });
  });

  it("publishes only supported sitewide organization and website facts", () => {
    const schema = buildSiteSchema();
    const serialized = JSON.stringify(schema);

    expect(schema).toMatchObject({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "Pretable",
          url: "https://pretable.ai",
          sameAs: ["https://github.com/cacheplane/pretable"],
        },
        {
          "@type": "WebSite",
          name: "Pretable",
          url: "https://pretable.ai",
        },
      ],
    });
    expect(serialized).not.toContain('"description"');
    expect(serialized).not.toContain('"@type":"Person"');
  });

  it("escapes less-than signs in rendered JSON-LD", () => {
    const html = renderToStaticMarkup(
      <JsonLd data={{ "@context": "https://schema.org", name: "</script>" }} />,
    );

    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script></script>");
    const payload = html.match(/<script[^>]*>(.*)<\/script>/)?.[1];
    expect(JSON.parse(payload ?? "")).toEqual({
      "@context": "https://schema.org",
      name: "</script>",
    });
  });
});
