import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { routes, type SeoRoute } from "../lib/seo/routes";

const execFile = promisify(execFileCallback);

export interface GenerateSitemapOptions {
  readonly routes: readonly SeoRoute[];
  readonly isShallow: () => Promise<boolean>;
  readonly lastModified: (sources: readonly string[]) => Promise<string | null>;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}

function isValidGitTimestamp(timestamp: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(
      timestamp,
    );
  if (!match || Number.isNaN(Date.parse(timestamp))) {
    return false;
  }

  const [, year, month, day, hour, minute, second, offset] = match;
  if (
    offset !== "Z" &&
    (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)
  ) {
    return false;
  }

  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Number(second), 0);

  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
  );
}

export async function generateSitemapXml({
  routes: sitemapRoutes,
  isShallow,
  lastModified,
}: GenerateSitemapOptions): Promise<string> {
  if (await isShallow()) {
    throw new Error("Cannot generate sitemap from a shallow Git history.");
  }

  const paths = new Set<string>();
  for (const route of sitemapRoutes) {
    if (paths.has(route.path)) {
      throw new Error(
        `Cannot generate sitemap with duplicate path: ${route.path}`,
      );
    }
    paths.add(route.path);
  }

  const entries = await Promise.all(
    sitemapRoutes.map(async (route) => {
      const timestamp = await lastModified(route.sources);
      if (timestamp === null) {
        throw new Error(`No Git timestamp found for ${route.path}.`);
      }
      if (!isValidGitTimestamp(timestamp)) {
        throw new Error(
          `Invalid Git timestamp for ${route.path}: ${timestamp}`,
        );
      }

      return [
        "  <url>",
        `    <loc>${escapeXml(`https://pretable.ai${route.path}`)}</loc>`,
        `    <lastmod>${escapeXml(timestamp)}</lastmod>`,
        "  </url>",
      ].join("\n");
    }),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

function getRepositoryRoot(): string {
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
}

async function isShallowRepository(repositoryRoot: string): Promise<boolean> {
  const { stdout } = await execFile(
    "git",
    ["rev-parse", "--is-shallow-repository"],
    { cwd: repositoryRoot },
  );

  return stdout.trim() === "true";
}

async function gitLastModified(
  repositoryRoot: string,
  sources: readonly string[],
): Promise<string | null> {
  const { stdout } = await execFile(
    "git",
    ["log", "-1", "--format=%cI", "--", ...sources],
    { cwd: repositoryRoot },
  );
  const timestamp = stdout.trim();

  return timestamp === "" ? null : timestamp;
}

export async function writeSitemap(): Promise<void> {
  const repositoryRoot = getRepositoryRoot();
  const outputPath = resolve(repositoryRoot, "apps/website/public/sitemap.xml");
  const xml = await generateSitemapXml({
    routes,
    isShallow: () => isShallowRepository(repositoryRoot),
    lastModified: (sources) => gitLastModified(repositoryRoot, sources),
  });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, xml, "utf8");
  await rename(temporaryPath, outputPath);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void writeSitemap().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
