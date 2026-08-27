import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROBOTS_PATH = path.join(__dirname, "../../../public/robots.txt");

function expectAllowedUserAgent(robots: string, userAgent: string) {
  const escapedUserAgent = userAgent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  expect(robots).toMatch(
    new RegExp(`(?:^|\\n)User-agent: ${escapedUserAgent}\\nAllow: /(?:\\n|$)`),
  );
}

describe("crawler assets", () => {
  it("publishes an explicit allow policy and canonical sitemap", () => {
    const robots = fs.readFileSync(ROBOTS_PATH, "utf8");

    for (const userAgent of [
      "GPTBot",
      "ClaudeBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
      "*",
    ]) {
      expectAllowedUserAgent(robots, userAgent);
    }

    expect(robots).toContain("Sitemap: https://pretable.ai/sitemap.xml");
    expect(robots.match(/^Sitemap: .*$/gm)).toEqual([
      "Sitemap: https://pretable.ai/sitemap.xml",
    ]);
  });
});
