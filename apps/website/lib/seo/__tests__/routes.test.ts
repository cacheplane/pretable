import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsNav } from "../../../app/docs/_nav";
import { slugToContentPath } from "../../docs/paths";
import { routes } from "../routes";

const DOCS_ROOT = path.join(__dirname, "../../../content/docs");

describe("SEO route registry", () => {
  it("contains the canonical route set in navigation order", () => {
    expect(routes).toHaveLength(51);
    expect(routes.map((route) => route.path)).toEqual([
      "/",
      "/bench",
      ...docsNav.flatMap((section) => section.items.map((item) => item.href)),
    ]);
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length);
    expect(routes.some((route) => route.path === "/docs")).toBe(false);
    expect(routes.every((route) => route.sources.length > 0)).toBe(true);
  });

  it("maps every docs route to an existing MDX page", () => {
    expect(routes[0]).toEqual({
      path: "/",
      kind: "home",
      sources: [
        "apps/website/app/page.tsx",
        "apps/website/app/layout.tsx",
        "apps/website/app/globals.css",
        "apps/website/app/styles",
        "apps/website/app/components",
        ":(exclude)apps/website/app/components/docs",
      ],
    });
    expect(routes[1]).toEqual({
      path: "/bench",
      kind: "bench",
      sources: [
        "apps/website/app/bench",
        "apps/website/app/globals.css",
        "status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json",
        "status/milestones/2026-05-08-b2-scroll-summary.json",
        "status/milestones/2026-05-09-b2-h1-high-repeat-correction.json",
        "status/milestones/2026-05-10-b2-sort-filter-summary.json",
      ],
    });

    for (const section of docsNav) {
      for (const item of section.items) {
        const slug = item.href.replace(/^\/docs\/?/, "").split("/");
        const contentPath = slugToContentPath(slug.filter(Boolean));
        const route = routes.find(
          ({ path: routePath }) => routePath === item.href,
        );

        expect(route?.kind).toBe("docs");
        expect(route?.sources).toEqual([
          `apps/website/content/docs/${contentPath}`,
        ]);

        expect(
          fs.existsSync(path.join(DOCS_ROOT, contentPath)),
          `${item.href} should resolve to ${contentPath}`,
        ).toBe(true);
      }
    }
  });
});
