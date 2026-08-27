import { docsNav } from "../../app/docs/_nav";
import { slugToContentPath } from "../docs/paths";

export interface SeoRoute {
  path: string;
  kind: "home" | "bench" | "docs";
  /** Repository-root-relative paths used to discover the route's last change. */
  sources: string[];
}

const HOMEPAGE_SOURCES = [
  "apps/website/app/page.tsx",
  "apps/website/app/layout.tsx",
  "apps/website/app/globals.css",
  "apps/website/app/styles",
  "apps/website/app/components",
  ":(exclude)apps/website/app/components/docs",
];

const BENCH_SOURCES = [
  "apps/website/app/bench",
  "apps/website/app/globals.css",
  "status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json",
  "status/milestones/2026-05-08-b2-scroll-summary.json",
  "status/milestones/2026-05-09-b2-h1-high-repeat-correction.json",
  "status/milestones/2026-05-10-b2-sort-filter-summary.json",
];

const docsRoutes: SeoRoute[] = docsNav.flatMap((section) =>
  section.items.map((item) => {
    const slug = item.href.replace(/^\/docs\/?/, "").split("/").filter(Boolean);

    return {
      path: item.href,
      kind: "docs",
      sources: [`apps/website/content/docs/${slugToContentPath(slug)}`],
    };
  }),
);

export const routes: SeoRoute[] = [
  { path: "/", kind: "home", sources: HOMEPAGE_SOURCES },
  { path: "/bench", kind: "bench", sources: BENCH_SOURCES },
  ...docsRoutes,
];
