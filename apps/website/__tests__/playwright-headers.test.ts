import { describe, expect, it } from "vitest";

import { getVercelProtectionBypassHeaders } from "../playwright-headers";

describe("getVercelProtectionBypassHeaders", () => {
  it("omits Playwright headers when no bypass secret is configured", () => {
    expect(getVercelProtectionBypassHeaders({})).toBeUndefined();
    expect(
      getVercelProtectionBypassHeaders({
        VERCEL_AUTOMATION_BYPASS_SECRET: "   ",
      }),
    ).toBeUndefined();
  });

  it("returns Vercel protection bypass headers for protected previews", () => {
    expect(
      getVercelProtectionBypassHeaders({
        VERCEL_AUTOMATION_BYPASS_SECRET: "preview-secret",
      }),
    ).toEqual({
      "x-vercel-protection-bypass": "preview-secret",
      "x-vercel-set-bypass-cookie": "true",
    });
  });
});
