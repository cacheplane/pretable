import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { docsNav } from "../_nav";

/**
 * The sidebar is a hand-maintained array, and until this file it was bound to
 * nothing. A page could be written, linked from other pages, and pass every
 * other check while never appearing in the sidebar at all — and `docsNav` is
 * also what `app/llms.txt/route.ts` enumerates, so an unlisted page is missing
 * from the machine-readable index too. It is not a rendering bug and no build
 * step reports it; the page simply has no way in.
 *
 * `order:` in the page frontmatter does NOT help here. `DocsFrontmatter.order`
 * is declared in `lib/docs/paths.ts` and read by nothing — every page carries
 * one and none of them does anything. This array is the only thing that decides
 * what the sidebar shows and in what order.
 *
 * The checks below compare RESOLVED FILES rather than URLs, on purpose.
 * `loadDocsPage` resolves a slug through two candidates (`<base>.mdx` and
 * `<base>/index.mdx`) and maps the empty slug onto `getting-started`, so one
 * page legitimately answers to more than one URL: `/docs` and
 * `/docs/getting-started` are the same file. Comparing hrefs would force an
 * exception for that; comparing files states the stronger property directly —
 * every page has exactly one way in, and every way in leads to a real page.
 */

const DOCS_ROOT = path.join(__dirname, "../../../content/docs");

/** Every `.mdx` page on disk, as absolute paths. */
function pagesOnDisk(): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(".mdx")) out.push(full);
    }
  };

  walk(DOCS_ROOT);
  return out.sort();
}

/**
 * The file a nav href renders, or `null` if it renders nothing.
 *
 * Mirrors `resolveFile` in `lib/docs/load.ts`, which is async and not exported.
 * Importing it would mean compiling all 38 pages' MDX to answer a filesystem
 * question, so this reimplements the resolution instead — and a mirror that
 * nothing checks is a mirror that drifts, so `LOADER_SOURCE` below fails the
 * moment the original's candidate list changes.
 */
function resolveHref(href: string): string | null {
  const slug = href
    .replace(/^\/docs\/?/, "")
    .split("/")
    .filter(Boolean);
  const base = slug.length === 0 ? "getting-started" : slug.join("/");

  for (const candidate of [
    path.join(DOCS_ROOT, `${base}.mdx`),
    path.join(DOCS_ROOT, base, "index.mdx"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const NAV_ITEMS = docsNav.flatMap((section) =>
  section.items.map((item) => ({ section: section.title, ...item })),
);

/** The real resolver this file mirrors, read as text to detect drift. */
const LOADER_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../lib/docs/load.ts"),
  "utf8",
);

describe("documentation navigation", () => {
  it("still mirrors the loader's slug resolution", () => {
    // Every branch `resolveHref` reproduces. If `resolveFile` grows a third
    // candidate, drops one, or stops special-casing the empty slug, one of
    // these disappears and this fails — which is the only thing standing
    // between the mirror and a silent divergence that leaves every check
    // below passing against resolution rules the site no longer uses.
    for (const fragment of [
      'slug.length === 0 ? "getting-started" : slug.join("/")',
      "path.join(root, `${base}.mdx`)",
      'path.join(root, base, "index.mdx")',
    ]) {
      expect(
        LOADER_SOURCE.includes(fragment),
        `lib/docs/load.ts no longer contains \`${fragment}\`. Its slug ` +
          "resolution changed; update `resolveHref` in this file to match, " +
          "then update this list.",
      ).toBe(true);
    }

    // And the candidate list is exactly two long, so an ADDED candidate is
    // caught as well as a changed one — the fragments above are all still
    // present when a third is appended beneath them.
    expect(
      [...LOADER_SOURCE.matchAll(/path\.join\(root, /g)].length,
      "lib/docs/load.ts resolves a different number of candidate paths than " +
        "`resolveHref` in this file does.",
    ).toBe(2);
  });

  it("places Grouping directly after Filtering", () => {
    const grid = docsNav.find((section) => section.title === "Grid");
    expect(grid).toBeDefined();

    const filtering = grid!.items.findIndex(
      (item) => item.href === "/docs/grid/filtering",
    );
    expect(filtering).toBeGreaterThanOrEqual(0);
    expect(grid!.items[filtering + 1]).toEqual({
      title: "Grouping",
      href: "/docs/grid/grouping",
    });
  });

  it("every nav entry points at a page that exists", () => {
    const dangling = NAV_ITEMS.filter(
      (item) => resolveHref(item.href) === null,
    ).map((item) => `${item.section} › ${item.title} → ${item.href}`);

    expect(
      dangling,
      "A sidebar entry links to a page that is not on disk. Renamed or " +
        "deleted the page? Update `app/docs/_nav.ts` — this href 404s.",
    ).toEqual([]);
  });

  it("every page on disk is reachable from the sidebar", () => {
    const reachable = new Set(
      NAV_ITEMS.map((item) => resolveHref(item.href)).filter(
        (file): file is string => file !== null,
      ),
    );

    const orphaned = pagesOnDisk()
      .filter((file) => !reachable.has(file))
      .map((file) => path.relative(DOCS_ROOT, file));

    expect(
      orphaned,
      "A docs page exists but nothing links to it from the sidebar, so " +
        "readers cannot find it and it is absent from `llms.txt`. Add it to " +
        "`app/docs/_nav.ts`. Note that `order:` in the frontmatter is read by " +
        "nothing — that array is what decides placement.",
    ).toEqual([]);
  });

  it("no two nav entries render the same page", () => {
    const seen = new Map<string, string[]>();

    for (const item of NAV_ITEMS) {
      const file = resolveHref(item.href);
      if (file === null) continue;
      seen.set(file, [...(seen.get(file) ?? []), item.href]);
    }

    const duplicated = [...seen.entries()]
      .filter(([, hrefs]) => hrefs.length > 1)
      .map(
        ([file, hrefs]) =>
          `${path.relative(DOCS_ROOT, file)}: ${hrefs.join(", ")}`,
      );

    expect(
      duplicated,
      "Two sidebar entries resolve to one page. A page answering to more " +
        "than one URL is a duplicate the reader can land on twice — pick the " +
        "canonical one. (`/docs` and `/docs/getting-started` are the same " +
        "file, which is exactly the pair this catches.)",
    ).toEqual([]);
  });
});
