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

  it("returns the bypass header (only) for protected previews", () => {
    // No x-vercel-set-bypass-cookie: that triggers a 307 cookie-seeding
    // redirect, which breaks responses fetched with maxRedirects: 0. The header
    // alone authorizes every request (Playwright sends it on all of them).
    expect(
      getVercelProtectionBypassHeaders({
        VERCEL_AUTOMATION_BYPASS_SECRET: "preview-secret",
      }),
    ).toEqual({
      "x-vercel-protection-bypass": "preview-secret",
    });
  });
});
