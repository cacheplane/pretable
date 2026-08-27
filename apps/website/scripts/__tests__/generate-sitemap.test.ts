import { describe, expect, it } from "vitest";

import { routes, type SeoRoute } from "../../lib/seo/routes";
import { generateSitemapXml } from "../generate-sitemap";

function route(
  path: string,
  sources = ["apps/website/app/page.tsx"],
): SeoRoute {
  return { path, kind: "docs", sources };
}

function options(
  overrides: Partial<Parameters<typeof generateSitemapXml>[0]> = {},
) {
  return {
    routes: [route("/example")],
    isShallow: async () => false,
    lastModified: async () => "2026-08-20T12:34:56+00:00",
    ...overrides,
  };
}

describe("generateSitemapXml", () => {
  it("rejects shallow Git histories", async () => {
    await expect(
      generateSitemapXml(options({ isShallow: async () => true })),
    ).rejects.toThrow(/shallow/i);
  });

  it("rejects a route without a Git timestamp", async () => {
    await expect(
      generateSitemapXml(options({ lastModified: async () => null })),
    ).rejects.toThrow(/Git timestamp.*\/example/i);
  });

  it("rejects an invalid Git timestamp", async () => {
    await expect(
      generateSitemapXml(
        options({ lastModified: async () => "2026-02-30T12:34:56+00:00" }),
      ),
    ).rejects.toThrow(/invalid Git timestamp/i);
  });

  it("emits all canonical routes as absolute locations with one lastmod each", async () => {
    const xml = await generateSitemapXml(
      options({
        routes,
        lastModified: async () => "2026-08-20T12:34:56+00:00",
      }),
    );

    expect(xml.match(/<loc>https:\/\/pretable\.ai\//g)).toHaveLength(49);
    expect(xml.match(/<lastmod>/g)).toHaveLength(49);
    expect(xml).not.toContain("<loc>https://pretable.ai/docs</loc>");
  });

  it("XML-escapes location values", async () => {
    const xml = await generateSitemapXml(
      options({ routes: [route("/search?query=table&sort=asc")] }),
    );

    expect(xml).toContain(
      "<loc>https://pretable.ai/search?query=table&amp;sort=asc</loc>",
    );
  });

  it("preserves each route's injected Git date", async () => {
    const xml = await generateSitemapXml(
      options({
        routes: [route("/one", ["one"]), route("/two", ["two"])],
        lastModified: async (sources) =>
          sources[0] === "one"
            ? "2024-01-02T03:04:05+00:00"
            : "2025-06-07T08:09:10+00:00",
      }),
    );

    expect(xml).toContain("<lastmod>2024-01-02T03:04:05+00:00</lastmod>");
    expect(xml).toContain("<lastmod>2025-06-07T08:09:10+00:00</lastmod>");
  });

  it("rejects duplicate route paths", async () => {
    await expect(
      generateSitemapXml(
        options({ routes: [route("/duplicate"), route("/duplicate")] }),
      ),
    ).rejects.toThrow(/duplicate/i);
  });
});
