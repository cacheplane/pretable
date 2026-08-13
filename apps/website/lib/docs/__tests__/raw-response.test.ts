import { describe, expect, it } from "vitest";

import { buildRawMarkdownResponse } from "../raw-response";

describe("buildRawMarkdownResponse", () => {
  it("composes title + description + raw body", async () => {
    const r = await buildRawMarkdownResponse({
      frontmatter: { title: "T", description: "D", nav: "Getting Started" },
      raw: "---\ntitle: T\n---\nbody",
    });
    expect(r.headers.get("content-type")).toMatch(/text\/markdown/);
    expect(await r.text()).toBe("# T\n\nD\n\nbody");
  });

  it("expands an <Example> tag in the body via expandExamples", async () => {
    const r = await buildRawMarkdownResponse({
      frontmatter: { title: "T", description: "D", nav: "Getting Started" },
      raw: '---\ntitle: T\n---\nbefore\n\n<Example id="grouping-panel" />\n\nafter',
    });
    const text = await r.text();
    expect(text).toContain("before");
    expect(text).toContain("after");
    expect(text).not.toContain("<Example");
  });
});
