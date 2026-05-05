import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildLlmsFullTxt } from "../build";

const ROOT = path.join(
  __dirname,
  "../../../lib/docs/__tests__/__fixtures__/content/docs",
);

describe("buildLlmsFullTxt", () => {
  it("includes title, description, and body for every page separated by ---", async () => {
    const txt = await buildLlmsFullTxt(ROOT);
    expect(txt).toMatch(/^# Alpha/);
    expect(txt).toMatch(/Alpha overview/);
    expect(txt).toMatch(/^# One/m);
    expect(txt).toMatch(/First page/);
    expect(txt).toMatch(/\n\n---\n\n/);
  });
});
