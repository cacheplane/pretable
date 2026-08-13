import path from "node:path";
import { describe, expect, it } from "vitest";

import { exampleRegistry } from "../../../lib/docs/examples/registry.generated";
import { exampleCatalogLine } from "../../../lib/docs/examples/serialize";
import { docsNav } from "../../docs/_nav";
import { buildLlmsTxt } from "../build";

const ROOT = path.join(
  __dirname,
  "../../../lib/docs/__tests__/__fixtures__/content/docs",
);

/** The real docs tree, which the fixture above deliberately is not. */
const REAL_ROOT = path.join(__dirname, "../../../content/docs");

const NAV = [
  {
    title: "Alpha",
    items: [
      { title: "Alpha overview", href: "/docs/alpha" },
      { title: "One", href: "/docs/alpha/one" },
    ],
  },
];

describe("buildLlmsTxt", () => {
  it("groups by nav and lists pages", async () => {
    const txt = await buildLlmsTxt(ROOT, NAV);
    expect(txt).toMatch(/^# Pretable Docs/);
    expect(txt).toMatch(/## Alpha/);
    expect(txt).toMatch(/- \[Alpha\]\(\/docs\/alpha\.md\): Alpha overview/);
    expect(txt).toMatch(/- \[One\]\(\/docs\/alpha\/one\.md\): First page/);
  });

  it("includes an Examples heading", async () => {
    const txt = await buildLlmsTxt(ROOT, NAV);
    expect(txt).toMatch(/^## Examples$/m);
  });

  it("lists every registered example via exampleCatalogLine", async () => {
    const txt = await buildLlmsTxt(ROOT, NAV);
    for (const [id, entry] of Object.entries(exampleRegistry)) {
      expect(txt).toContain(exampleCatalogLine(id, entry.meta));
    }
  });

  it("places the Examples section after the docs nav sections", async () => {
    const txt = await buildLlmsTxt(ROOT, NAV);
    const navIndex = txt.indexOf("## Alpha");
    const examplesIndex = txt.indexOf("## Examples");
    expect(navIndex).toBeGreaterThanOrEqual(0);
    expect(examplesIndex).toBeGreaterThan(navIndex);
  });

  /**
   * Against the REAL nav and the REAL docs, because the fixture case above
   * cannot see the bug this covers.
   *
   * `buildLlmsTxt` used to look pages up by canonical slug and `continue` past
   * a miss. `getting-started/index.mdx` has the empty slug, so its canonical
   * URL is `/docs` while the sidebar lists `/docs/getting-started` — the lookup
   * missed, the `continue` swallowed it, and the first entry in the sidebar was
   * absent from llms.txt. Nothing failed; the file was simply one line short,
   * which is only visible if you count.
   */
  it("lists every nav entry, against the real docs tree", async () => {
    const txt = await buildLlmsTxt(REAL_ROOT, docsNav);
    const listed = new Set(
      [...txt.matchAll(/\]\((\/docs[^)]*)\.md\)/g)].map((m) => m[1] as string),
    );

    const missing = docsNav.flatMap((section) =>
      section.items
        .filter((item) => !listed.has(item.href))
        .map((item) => `${section.title} › ${item.title} → ${item.href}`),
    );

    expect(
      missing,
      "A sidebar entry is missing from llms.txt. Every page readers can " +
        "reach should be in the machine-readable index too.",
    ).toEqual([]);
  });

  it("refuses to publish an index that silently omits a page", async () => {
    await expect(
      buildLlmsTxt(REAL_ROOT, [
        { title: "Broken", items: [{ title: "Gone", href: "/docs/nope" }] },
      ]),
    ).rejects.toThrow(/resolves to no page/);
  });
});
