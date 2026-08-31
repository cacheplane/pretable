import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import { describe, expect, it } from "vitest";

import { BENCH_PAGE_DESCRIPTOR } from "../../../app/bench/page";
import { HOME_PAGE_DESCRIPTOR } from "../page";
import { routes } from "../routes";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const ALLOWED_FRONTMATTER_FIELDS = ["description", "nav", "title"];

interface ContentMetadata {
  path: string;
  title: string;
  renderedTitle: string;
  description: string;
  fields: string[];
}

function requireFrontmatterString(
  data: Record<string, unknown>,
  field: "title" | "description",
  routePath: string,
): string {
  expect(typeof data[field], `${routePath} ${field}`).toBe("string");
  const value = data[field];
  if (typeof value !== "string") {
    throw new TypeError(`${routePath} ${field} must be a string`);
  }
  return value;
}

function readContentMetadata(): ContentMetadata[] {
  const docs = routes
    .filter((route) => route.kind === "docs")
    .map((route) => {
      const source = route.sources[0];
      if (!source) {
        throw new Error(`Missing content source for ${route.path}`);
      }

      const { data } = matter(
        fs.readFileSync(path.join(REPOSITORY_ROOT, source), "utf8"),
      );
      const title = requireFrontmatterString(data, "title", route.path);
      const description = requireFrontmatterString(
        data,
        "description",
        route.path,
      );

      return {
        path: route.path,
        title,
        renderedTitle: `${title} — Pretable`,
        description,
        fields: Object.keys(data).sort(),
      };
    });

  return [
    {
      path: HOME_PAGE_DESCRIPTOR.canonicalPath,
      title: HOME_PAGE_DESCRIPTOR.title,
      renderedTitle: HOME_PAGE_DESCRIPTOR.title,
      description: HOME_PAGE_DESCRIPTOR.description,
      fields: ALLOWED_FRONTMATTER_FIELDS,
    },
    {
      path: BENCH_PAGE_DESCRIPTOR.canonicalPath,
      title: BENCH_PAGE_DESCRIPTOR.title,
      renderedTitle: BENCH_PAGE_DESCRIPTOR.title,
      description: BENCH_PAGE_DESCRIPTOR.description,
      fields: ALLOWED_FRONTMATTER_FIELDS,
    },
    ...docs,
  ];
}

describe("canonical content metadata", () => {
  const pages = readContentMetadata();

  it("keeps every description nonempty and within 155 characters", () => {
    const invalid = pages
      .filter(
        (page) =>
          page.description.trim().length === 0 || page.description.length > 155,
      )
      .map((page) => ({
        path: page.path,
        length: page.description.length,
      }));

    expect(invalid).toEqual([]);
  });

  it("keeps all 50 rendered page titles unique", () => {
    const counts = new Map<string, number>();
    for (const page of pages) {
      counts.set(page.renderedTitle, (counts.get(page.renderedTitle) ?? 0) + 1);
    }
    const duplicates = [...counts]
      .filter(([, count]) => count > 1)
      .map(([title, count]) => ({ title, count }));

    expect(pages).toHaveLength(50);
    expect(duplicates).toEqual([]);
  });

  it("gives each API reference a distinct, front-loaded title", () => {
    const expectedPrefixes = new Map([
      ["/docs/grid/api-reference", "Grid"],
      ["/docs/headless/api-reference", "Headless"],
      ["/docs/streaming/api-reference", "Streaming"],
    ]);
    const apiPages = pages.filter((page) => expectedPrefixes.has(page.path));

    expect(apiPages).toHaveLength(expectedPrefixes.size);
    expect(new Set(apiPages.map((page) => page.title)).size).toBe(
      apiPages.length,
    );
    for (const page of apiPages) {
      expect(page.title).toMatch(
        new RegExp(`^${expectedPrefixes.get(page.path)}\\b`),
      );
    }
  });

  it("keeps docs frontmatter limited to title, description, and nav", () => {
    const docsPages = pages.filter((page) => page.path.startsWith("/docs/"));

    for (const page of docsPages) {
      expect(page.fields, page.path).toEqual(ALLOWED_FRONTMATTER_FIELDS);
    }
  });
});
