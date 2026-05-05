import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildLlmsTxt } from "../build";

const ROOT = path.join(
  __dirname,
  "../../../lib/docs/__tests__/__fixtures__/content/docs",
);

describe("buildLlmsTxt", () => {
  it("groups by nav and lists pages", async () => {
    const txt = await buildLlmsTxt(ROOT, [
      {
        title: "Alpha",
        items: [
          { title: "Alpha overview", href: "/docs/alpha" },
          { title: "One", href: "/docs/alpha/one" },
        ],
      },
    ]);
    expect(txt).toMatch(/^# Pretable Docs/);
    expect(txt).toMatch(/## Alpha/);
    expect(txt).toMatch(
      /- \[Alpha\]\(\/docs\/alpha\.md\): Alpha overview/,
    );
    expect(txt).toMatch(/- \[One\]\(\/docs\/alpha\/one\.md\): First page/);
  });
});
