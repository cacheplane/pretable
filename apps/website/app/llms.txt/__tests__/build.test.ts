import path from "node:path";
import { describe, expect, it } from "vitest";

import { exampleRegistry } from "../../../lib/docs/examples/registry.generated";
import { exampleCatalogLine } from "../../../lib/docs/examples/serialize";
import { buildLlmsTxt } from "../build";

const ROOT = path.join(
  __dirname,
  "../../../lib/docs/__tests__/__fixtures__/content/docs",
);

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
});
