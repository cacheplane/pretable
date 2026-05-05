import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadDocsPage } from "../load";

const ROOT = path.join(__dirname, "__fixtures__/content/docs");

describe("loadDocsPage", () => {
  it("loads frontmatter and raw source", async () => {
    const r = await loadDocsPage(["alpha", "one"], { root: ROOT });
    expect(r.frontmatter.title).toBe("One");
    expect(r.raw).toContain("# One");
    expect(r.headings).toEqual([]);
  });
  it("falls back to index.mdx for group slug", async () => {
    const r = await loadDocsPage(["alpha"], { root: ROOT });
    expect(r.frontmatter.title).toBe("Alpha");
  });
  it("throws on missing", async () => {
    await expect(loadDocsPage(["nope"], { root: ROOT })).rejects.toThrow();
  });
});
