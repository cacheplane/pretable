import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSearchIndex, stripTagShapedText } from "../search-index";

const ROOT = path.join(__dirname, "__fixtures__/content/docs");

describe("buildSearchIndex", () => {
  it("returns one entry per page with title, headings, body excerpt", async () => {
    const idx = await buildSearchIndex(ROOT);
    expect(idx).toHaveLength(2);
    expect(idx[0]).toMatchObject({ title: "Alpha", nav: "Alpha" });
    expect(typeof idx[0].body).toBe("string");
  });

  it("strips complete, nested, and unterminated tag-shaped input in one pass", () => {
    const input =
      "Searchable <em>safe</em> prose. Nested <<script>alert(1)</script> boundary. Unterminated before <script after";
    const body = stripTagShapedText(input);

    expect(body).toBe(
      "Searchable safe prose. Nested alert(1) boundary. Unterminated before ",
    );
    expect(body.toLowerCase()).not.toContain("<script");
  });
});
