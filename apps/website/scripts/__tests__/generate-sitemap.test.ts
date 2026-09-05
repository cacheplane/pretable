import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SITE_ORIGIN } from "../../lib/seo/page";
import { routes, type SeoRoute } from "../../lib/seo/routes";
import {
  generateSitemapXml,
  parseSitemapXml,
  validateSitemapDistribution,
  writeSitemap,
} from "../generate-sitemap";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

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

  it("rejects a route without sources before asking Git for a timestamp", async () => {
    let lastModifiedCalls = 0;

    await expect(
      generateSitemapXml(
        options({
          routes: [route("/source-less", [])],
          lastModified: async () => {
            lastModifiedCalls += 1;
            return "2026-08-20T12:34:56+00:00";
          },
        }),
      ),
    ).rejects.toThrow(/source.*\/source-less/i);

    expect(lastModifiedCalls).toBe(0);
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

    expect(xml.match(new RegExp(`<loc>${SITE_ORIGIN}/`, "g"))).toHaveLength(51);
    expect(xml.match(/<lastmod>/g)).toHaveLength(51);
    expect(xml).not.toContain("<loc>https://pretable.ai/docs</loc>");
  });

  it("builds locations from the configured origin boundary", async () => {
    const xml = await generateSitemapXml(
      options({ origin: "https://example.test" }),
    );

    expect(xml).toContain("<loc>https://example.test/example</loc>");
    expect(xml).not.toContain(SITE_ORIGIN);
  });

  it("XML-escapes location values", async () => {
    const xml = await generateSitemapXml(
      options({ routes: [route("/search?query=table&sort=asc")] }),
    );

    expect(xml).toContain(
      "<loc>https://pretable.ai/search?query=table&amp;sort=asc</loc>",
    );
    expect(parseSitemapXml(xml)[0]?.loc).toBe(
      "https://pretable.ai/search?query=table&sort=asc",
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

  it("rejects a real canonical output whose lastmod distribution collapsed", async () => {
    const xml = await generateSitemapXml(
      options({
        routes,
        lastModified: async () => "2026-08-20T12:34:56+00:00",
      }),
    );

    expect(() => validateSitemapDistribution(xml, routes.length)).toThrow(
      /distinct lastmod/i,
    );
  });

  it("accepts a complete canonical output with varied lastmod dates", async () => {
    let call = 0;
    const xml = await generateSitemapXml(
      options({
        routes,
        lastModified: async () => {
          call += 1;
          return call === 1
            ? "2025-08-20T12:34:56+00:00"
            : "2026-08-20T12:34:56+00:00";
        },
      }),
    );

    expect(() => validateSitemapDistribution(xml, routes.length)).not.toThrow();
  });

  it("validates the generated distribution before writing the sitemap", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "pretable-sitemap-"));
    temporaryDirectories.push(directory);
    const outputPath = resolve(directory, "sitemap.xml");

    await expect(
      writeSitemap({
        outputPath,
        routes,
        isShallow: async () => false,
        lastModified: async () => "2026-08-20T12:34:56+00:00",
      }),
    ).rejects.toThrow(/distinct lastmod/i);
    await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate route paths", async () => {
    await expect(
      generateSitemapXml(
        options({ routes: [route("/duplicate"), route("/duplicate")] }),
      ),
    ).rejects.toThrow(/duplicate/i);
  });
});
