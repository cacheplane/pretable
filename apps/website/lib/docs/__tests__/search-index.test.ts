import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSearchIndex } from "../search-index";

const ROOT = path.join(__dirname, "__fixtures__/content/docs");

describe("buildSearchIndex", () => {
  it("returns one entry per page with title, headings, body excerpt", async () => {
    const idx = await buildSearchIndex(ROOT);
    expect(idx).toHaveLength(2);
    expect(idx[0]).toMatchObject({ title: "Alpha", nav: "Alpha" });
    expect(typeof idx[0].body).toBe("string");
  });
});
