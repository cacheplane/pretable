import { describe, expect, it } from "vitest";

import { buildRawMarkdownResponse } from "../raw-response";

describe("buildRawMarkdownResponse", () => {
  it("composes title + description + raw body", async () => {
    const r = buildRawMarkdownResponse({
      frontmatter: { title: "T", description: "D", nav: "Getting Started" },
      raw: "---\ntitle: T\n---\nbody",
    });
    expect(r.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(await r.text()).toBe("# T\n\nD\n\nbody");
  });
});
