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

/** Every `.mdx` page on disk, as a set — see `resolveHref` for why a set. */
const PAGES_ON_DISK = new Set(pagesOnDisk());

/**
 * The file a nav href renders, or `null` if it renders nothing.
 *
 * Mirrors `resolveFile` in `lib/docs/load.ts`, which is async and not exported.
 * Importing it would mean compiling every page's MDX to answer a filesystem
 * question, so this reimplements the resolution instead — and a mirror that
 * nothing checks is a mirror that drifts, so `LOADER_SOURCE` below fails the
 * moment the original's candidate list changes.
 *
 * A candidate is looked up in {@link PAGES_ON_DISK} rather than through
 * `fs.existsSync`, which is a deliberate difference from the loader and the one
 * place this is stricter than what it mirrors.
 *
 * `existsSync` answers according to the FILESYSTEM's case rules, and the two
 * filesystems this suite runs on disagree: macOS says yes to
 * `/docs/Grid/Filtering`, Linux says no. On macOS the resolver then returned a
 * path with the href's casing, which is in no page's `pagesOnDisk` entry — so
 * the dangling check passed, and the REAL page showed up in the orphan check
 * instead, under "a docs page exists but nothing links to it". That message
 * sends the author to look for a missing nav entry that is right there. A set
 * of the files that actually exist gives the same answer on both platforms, and
 * it is the answer that produces the honest message: a wrong-case href resolves
 * to nothing and is reported as dangling, which is what it is.
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
    if (PAGES_ON_DISK.has(candidate)) return candidate;
  }

  return null;
}

/**
 * The `nav:` line out of a page's frontmatter, or `null` if it has none.
 *
 * Read as text rather than through `loadDocsPage`, for the same reason
 * `resolveHref` exists: compiling MDX to read a frontmatter field would make
 * this suite depend on every page's components rendering.
 */
function navFrontmatter(file: string): string | null {
  const raw = fs.readFileSync(file, "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw);

  if (!frontmatter) return null;

  return /^nav:\s*(.+?)\s*$/m.exec(frontmatter[1] as string)?.[1] ?? null;
}

/**
 * Pages whose `nav:` frontmatter legitimately differs from the sidebar section
 * they sit under, and why.
 *
 * Empty, and today every page agrees. Enforced both ways, so an entry for a
 * page that has since come back into line fails too: a stale exception is
 * standing permission for whatever the next edit does to that page's field.
 */
const NAV_FRONTMATTER_EXCEPTIONS: Record<string, string> = {};

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
    // The empty-slug special case, which lives outside the candidate array.
    const base = 'slug.length === 0 ? "getting-started" : slug.join("/")';

    expect(
      LOADER_SOURCE.includes(base),
      `lib/docs/load.ts no longer contains \`${base}\`. Its slug resolution ` +
        "changed; update `resolveHref` in this file to match, then update this " +
        "check.",
    ).toBe(true);

    // And the candidate list, compared as SOURCE TEXT, in order.
    //
    // This used to be two `includes()` fragments plus a count of
    // `path.join(root, ` occurrences, and both of those are order-blind. Swap
    // the two lines in `load.ts` and every fragment still matches and the count
    // is still 2 — while resolution precedence has flipped, so a directory
    // holding both `x.mdx` and `x/index.mdx` now renders the other one and the
    // mirror below is silently wrong about which. A third candidate written
    // with `path.resolve` slipped through the same pair of holes: the fragments
    // are all still present, and the count only ever counted `path.join`.
    //
    // The array's own text answers all three questions at once — which
    // candidates, how many, in what order — and answers them about the thing
    // `resolveHref` actually reproduces rather than about tokens that happen to
    // appear near it.
    const candidates = /const candidates = \[([\s\S]*?)\];/.exec(LOADER_SOURCE);

    expect(
      candidates,
      "lib/docs/load.ts no longer declares `const candidates = [...]`. That " +
        "array is what `resolveHref` in this file mirrors; if the loader was " +
        "restructured, re-point this check — do not delete it.",
    ).not.toBeNull();

    expect(
      (candidates![1] as string).replace(/\s+/g, " ").trim().replace(/,$/, ""),
      "lib/docs/load.ts resolves a different candidate list than `resolveHref` " +
        "in this file does — a different path, a different number of them, or " +
        "the same two in the other order. Order is precedence: the first " +
        "candidate that exists is the page that renders.",
    ).toBe(
      'path.join(root, `${base}.mdx`), path.join(root, base, "index.mdx")',
    );
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

  it("every page's `nav:` frontmatter matches the section it sits under", () => {
    // `nav:` is read by `lib/docs/search-index.ts`, which groups search results
    // by it, and by nothing else. It is the only field pairing a page with the
    // sidebar section it belongs to, and until this check it was bound to
    // nothing: retyping this page's `nav: Grid` to `nav: Theming` left the
    // suite green and filed it under Theming in search, in a section it does
    // not appear in. That is the same "hand-maintained field feeding a surface
    // with nothing checking it" the rest of this file exists to close, one
    // field over.
    //
    // `docsNav` is the authority, because it is what actually renders. A
    // mismatch is a frontmatter typo far more often than a misplaced nav entry.
    const problems: string[] = [];
    const excused = new Set(Object.keys(NAV_FRONTMATTER_EXCEPTIONS));
    const matched = new Set<string>();
    let compared = 0;

    for (const item of NAV_ITEMS) {
      const file = resolveHref(item.href);

      // Dangling hrefs are the previous check's failure to report.
      if (file === null) continue;

      const rel = path.relative(DOCS_ROOT, file);
      const nav = navFrontmatter(file);

      if (excused.has(rel)) {
        matched.add(rel);

        if (nav === item.section) {
          problems.push(
            `${rel}: excused in NAV_FRONTMATTER_EXCEPTIONS ("${NAV_FRONTMATTER_EXCEPTIONS[rel]}"), but its \`nav:\` now agrees with the sidebar. Delete the entry so the page is checked like the rest.`,
          );
        }

        continue;
      }

      if (nav === null) {
        problems.push(
          `${rel}: no \`nav:\` in its frontmatter. Search groups results by that field, so a page without one is filed under nothing.`,
        );
        continue;
      }

      compared += 1;

      if (nav !== item.section) {
        problems.push(
          `${rel}: \`nav: ${nav}\`, but the sidebar lists it under "${item.section}". Search would file it in a section it does not appear in.`,
        );
      }
    }

    for (const rel of [...excused].filter((entry) => !matched.has(entry))) {
      problems.push(
        `${rel}: excused in NAV_FRONTMATTER_EXCEPTIONS, but no nav entry resolves to that page — a stale exception is a hole held open for whatever page lands on that path next.`,
      );
    }

    expect(
      problems,
      "A page's `nav:` frontmatter and the sidebar section it appears under " +
        "disagree. `lib/docs/search-index.ts` groups search results by `nav:`; " +
        "`app/docs/_nav.ts` decides what the sidebar shows. When they differ, " +
        "a reader finds the page filed under one heading and listed under " +
        "another, and nothing but this check says so.",
    ).toEqual([]);

    // Fail closed: the frontmatter read is a regex over the raw file, and a
    // regex that stops matching turns every comparison above into a `null`
    // that the loop reports — or, if the exception roster ever swallows them,
    // into nothing at all.
    expect(
      compared,
      "not one page's `nav:` was compared against its sidebar section. " +
        "`navFrontmatter` is reading nothing, or every page has been excused.",
    ).toBeGreaterThan(0);
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
