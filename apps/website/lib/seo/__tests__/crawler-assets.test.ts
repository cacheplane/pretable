import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROBOTS_PATH = path.join(__dirname, "../../../public/robots.txt");
const OG_IMAGE_PATH = path.join(__dirname, "../../../public/og/pretable.png");

interface RobotsGroup {
  readonly userAgents: readonly string[];
  readonly directives: readonly { name: string; value: string }[];
}

interface ParsedRobots {
  readonly groups: readonly RobotsGroup[];
  readonly sitemaps: readonly string[];
}

function parseRobots(robots: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let userAgents: string[] = [];
  let directives: { name: string; value: string }[] = [];

  const finishGroup = () => {
    if (userAgents.length > 0) {
      groups.push({ userAgents, directives });
    }
    userAgents = [];
    directives = [];
  };

  for (const rawLine of robots.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      if (!rawLine.trim()) finishGroup();
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;

    if (name === "user-agent") {
      if (directives.length > 0) finishGroup();
      userAgents.push(value.toLowerCase());
      continue;
    }

    if (name === "sitemap") {
      sitemaps.push(value);
      continue;
    }

    if (userAgents.length > 0) directives.push({ name, value });
  }

  finishGroup();
  return { groups, sitemaps };
}

function expectAllowedUserAgent(robots: ParsedRobots, userAgent: string) {
  const matchingGroups = robots.groups.filter((group) =>
    group.userAgents.includes(userAgent.toLowerCase()),
  );

  expect(matchingGroups).not.toHaveLength(0);
  expect(
    matchingGroups.some((group) =>
      group.directives.some(
        (directive) => directive.name === "allow" && directive.value === "/",
      ),
    ),
  ).toBe(true);
  expect(
    matchingGroups.flatMap((group) => group.directives),
  ).not.toContainEqual(expect.objectContaining({ name: "disallow" }));
}

describe("crawler assets", () => {
  it("publishes an explicit allow policy and canonical sitemap", () => {
    const robots = parseRobots(fs.readFileSync(ROBOTS_PATH, "utf8"));

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

    expect(robots.sitemaps).toEqual(["https://pretable.ai/sitemap.xml"]);
  });

  it("rejects a later duplicate group that denies a required crawler", () => {
    const robots = parseRobots(
      [
        "User-agent: GPTBot",
        "# A comment does not end the group.",
        "Allow: /",
        "",
        "User-agent: GPTBot",
        "Disallow: /private",
      ].join("\r\n"),
    );

    expect(() => expectAllowedUserAgent(robots, "GPTBot")).toThrow();
  });

  it("publishes a social preview image with stable PNG dimensions", () => {
    const image = fs.readFileSync(OG_IMAGE_PATH);

    expect(image.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(image.subarray(12, 16)).toEqual(Buffer.from("IHDR"));
    expect(image.readUInt32BE(16)).toBe(1200);
    expect(image.readUInt32BE(20)).toBe(630);
    expect(image.byteLength).toBeGreaterThan(10 * 1024);
  });
});
