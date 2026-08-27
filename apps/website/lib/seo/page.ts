import type { Metadata } from "next";

export const SITE_ORIGIN = "https://pretable.ai";
export const SITE_NAME = "Pretable";
export const REPOSITORY_URL = "https://github.com/cacheplane/pretable";
export const OG_IMAGE_PATH = "/og/pretable.png";
export const OG_IMAGE_URL = `${SITE_ORIGIN}${OG_IMAGE_PATH}`;

export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface PageDescriptor {
  title: string;
  description: string;
  canonicalPath: string;
  schemaHeadline: string;
  kind: "webPage" | "techArticle";
  markdownAlternate?: string;
  breadcrumb?: readonly BreadcrumbItem[];
}

export const HOME_PAGE_DESCRIPTOR: PageDescriptor = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
  canonicalPath: "/",
  schemaHeadline: "Pretable",
  kind: "webPage",
};

export function absoluteSiteUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}

export function resolvePageMetadata(descriptor: PageDescriptor): Metadata {
  const canonical = absoluteSiteUrl(descriptor.canonicalPath);
  const markdownAlternate = descriptor.markdownAlternate
    ? absoluteSiteUrl(descriptor.markdownAlternate)
    : undefined;

  return {
    title: descriptor.title,
    description: descriptor.description,
    alternates: {
      canonical,
      ...(markdownAlternate
        ? { types: { "text/markdown": markdownAlternate } }
        : {}),
    },
    openGraph: {
      type: descriptor.kind === "techArticle" ? "article" : "website",
      url: canonical,
      title: descriptor.title,
      description: descriptor.description,
      siteName: SITE_NAME,
      images: [
        {
          url: OG_IMAGE_URL,
          width: 1200,
          height: 630,
          alt: SITE_NAME,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: descriptor.title,
      description: descriptor.description,
      images: [OG_IMAGE_URL],
    },
  };
}

export function buildPageSchema(
  descriptor: PageDescriptor,
): Record<string, unknown> {
  const canonical = absoluteSiteUrl(descriptor.canonicalPath);
  const pageSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": descriptor.kind === "techArticle" ? "TechArticle" : "WebPage",
    url: canonical,
    name: descriptor.schemaHeadline,
    description: descriptor.description,
    image: OG_IMAGE_URL,
    isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
  };

  if (descriptor.kind === "techArticle") {
    pageSchema.headline = descriptor.schemaHeadline;
  }

  return pageSchema;
}

export function buildBreadcrumbSchema(
  descriptor: PageDescriptor,
): Record<string, unknown> | null {
  if (!descriptor.breadcrumb) {
    return null;
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: descriptor.breadcrumb.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteSiteUrl(item.path),
    })),
  };
}

export function buildSiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_ORIGIN}/#organization`,
        name: SITE_NAME,
        url: SITE_ORIGIN,
        sameAs: [REPOSITORY_URL],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        name: SITE_NAME,
        url: SITE_ORIGIN,
        publisher: { "@id": `${SITE_ORIGIN}/#organization` },
      },
    ],
  };
}
