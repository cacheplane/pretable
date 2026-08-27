import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsNav } from "../../../app/docs/_nav";
import { slugToContentPath } from "../../docs/paths";
import { routes } from "../routes";

const DOCS_ROOT = path.join(__dirname, "../../../content/docs");

describe("SEO route registry", () => {
  it("contains the canonical route set in navigation order", () => {
    expect(routes).toHaveLength(49);
    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/bench",
      ...docsNav.flatMap((section) =>
        section.items.map((item) => item.href),
      ),
    ]);
    expect(new Set(routes.map((route) => route.path)).size).toBe(
      routes.length,
    );
    expect(routes.some((route) => route.path === "/docs")).toBe(false);
    expect(routes.every((route) => route.sources.length > 0)).toBe(true);
  });

  it("maps every docs route to an existing MDX page", () => {
    for (const section of docsNav) {
      for (const item of section.items) {
        const slug = item.href.replace(/^\/docs\/?/, "").split("/");
        const contentPath = slugToContentPath(slug.filter(Boolean));

        expect(
          fs.existsSync(path.join(DOCS_ROOT, contentPath)),
          `${item.href} should resolve to ${contentPath}`,
        ).toBe(true);
      }
    }
  });
});
