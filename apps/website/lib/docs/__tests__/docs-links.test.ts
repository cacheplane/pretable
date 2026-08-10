import fs from "node:fs";
import path from "node:path";

import GithubSlugger from "github-slugger";
import { describe, expect, test } from "vitest";

import { contentPathToSlug } from "../paths";

/**
 * Internal `/docs/*` links, checked against the pages and headings that exist.
 *
 * `next build` does not catch these: MDX links are rendered, not resolved, so a
 * link to a page that was renamed or an `#anchor` whose heading was reworded
 * compiles cleanly and 404s (or silently scrolls nowhere) in the browser. The
 * heading slugs are computed with the same `github-slugger` the page's own
 * table of contents uses, so an anchor passes here exactly when it works.
 */

const DOCS_ROOT = path.join(__dirname, "../../../content/docs");
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;
const FENCE_RE = /^```[^\n]*\n([\s\S]*?)^```/gm;
const HEADING_RE = /^(#{2,3})\s+(.+?)\s*$/gm;
/** Markdown links only — MDX/JSX `href=` attributes are not used in content. */
const DOCS_LINK_RE = /\]\((\/docs[^)\s]*)\)/g;

interface Page {
  rel: string;
  href: string;
  raw: string;
  anchors: Set<string>;
}

function readPages(): Page[] {
  const files: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith(".mdx")) files.push(full);
    }
  };

  walk(DOCS_ROOT);
  files.sort();

  return files.map((file) => {
    const raw = fs.readFileSync(file, "utf8");
    const rel = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
    const slug = contentPathToSlug(rel);
    const slugger = new GithubSlugger();
    const anchors = new Set<string>();
    const body = raw.replace(FRONTMATTER_RE, "").replace(FENCE_RE, "");

    for (const heading of body.matchAll(HEADING_RE)) {
      anchors.add(slugger.slug((heading[2] as string).replace(/`/g, "")));
    }

    return {
      rel,
      href: slug.length === 0 ? "/docs" : `/docs/${slug.join("/")}`,
      raw,
      anchors,
    };
  });
}

const PAGES = readPages();
const BY_HREF = new Map(PAGES.map((page) => [page.href, page]));

describe("internal docs links", () => {
  test("the corpus was actually found", () => {
    expect(PAGES.length, `no .mdx pages under ${DOCS_ROOT}`).toBeGreaterThan(10);
  });

  test("every /docs link resolves to a page, and every #anchor to a heading", () => {
    const broken: string[] = [];

    for (const page of PAGES) {
      for (const match of page.raw.matchAll(DOCS_LINK_RE)) {
        const href = match[1] as string;
        const [base, fragment] = href.split("#");
        const target = BY_HREF.get(base as string);

        if (!target) {
          broken.push(`${page.rel} → ${href} (no such page)`);
          continue;
        }

        if (fragment && !target.anchors.has(fragment)) {
          broken.push(
            `${page.rel} → ${href} (${target.rel} has no heading slugged "${fragment}"; it has ${[...target.anchors].join(", ")})`,
          );
        }
      }
    }

    expect(
      broken,
      [
        "A docs page links somewhere that does not exist.",
        "",
        ...broken,
        "",
        "Fix the link, or restore the heading it points at. Heading slugs come",
        "from the heading text, so rewording a heading breaks every link to it.",
      ].join("\n"),
    ).toEqual([]);
  });
});
