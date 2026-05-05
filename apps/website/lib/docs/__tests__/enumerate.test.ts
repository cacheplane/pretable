import path from "node:path";
import { describe, expect, it } from "vitest";

import { enumerateDocs } from "../enumerate";

const ROOT = path.join(__dirname, "__fixtures__/content/docs");

describe("enumerateDocs", () => {
  it("returns slug + frontmatter for every .mdx file", async () => {
    const pages = await enumerateDocs(ROOT);
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => p.slug)).toEqual([["alpha"], ["alpha", "one"]]);
    expect(pages[0].frontmatter.title).toBe("Alpha");
  });
});
