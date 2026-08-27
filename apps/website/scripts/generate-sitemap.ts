import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { SITE_ORIGIN } from "../lib/seo/page";
import { routes, type SeoRoute } from "../lib/seo/routes";

const execFile = promisify(execFileCallback);

export interface GenerateSitemapOptions {
  readonly routes: readonly SeoRoute[];
  readonly origin?: string;
  readonly isShallow: () => Promise<boolean>;
  readonly lastModified: (sources: readonly string[]) => Promise<string | null>;
}

export interface WriteSitemapOptions {
  readonly outputPath?: string;
  readonly routes?: readonly SeoRoute[];
  readonly isShallow?: () => Promise<boolean>;
  readonly lastModified?: (
    sources: readonly string[],
  ) => Promise<string | null>;
}

interface SitemapEntry {
  readonly loc: string;
  readonly lastmod: string;
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

function decodeXmlText(value: string): string {
  if (/&(?!amp;|lt;|gt;|apos;|quot;)/.test(value)) {
    throw new Error("Sitemap contains a malformed XML entity.");
  }

  return value.replace(/&(amp|lt|gt|apos|quot);/g, (_, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "apos":
        return "'";
      case "quot":
        return '"';
      default:
        throw new Error(`Unsupported XML entity: &${entity};`);
    }
  });
}

export function parseSitemapXml(xml: string): readonly SitemapEntry[] {
  const document = xml.trim();
  const root =
    /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\s*([\s\S]*?)\s*<\/urlset>$/.exec(
      document,
    );
  if (!root) {
    throw new Error("Sitemap XML has an invalid document or urlset root.");
  }

  const body = root[1] ?? "";
  const entryPattern =
    /\s*<url>\s*<loc>([^<]*)<\/loc>\s*<lastmod>([^<]*)<\/lastmod>\s*<\/url>/gy;
  const entries: SitemapEntry[] = [];
  let cursor = 0;

  while (cursor < body.length) {
    entryPattern.lastIndex = cursor;
    const match = entryPattern.exec(body);
    if (!match) {
      if (body.slice(cursor).trim() === "") break;
      throw new Error("Sitemap XML contains a malformed url entry.");
    }

    const loc = decodeXmlText(match[1] ?? "");
    const lastmod = decodeXmlText(match[2] ?? "");
    if (loc === "" || lastmod === "") {
      throw new Error("Every sitemap url requires one loc and one lastmod.");
    }

    entries.push({ loc, lastmod });
    cursor = entryPattern.lastIndex;
  }

  return entries;
}

export function validateSitemapDistribution(
  xml: string,
  expectedRouteCount: number,
): void {
  const entries = parseSitemapXml(xml);
  if (entries.length !== expectedRouteCount) {
    throw new Error(
      `Sitemap has ${entries.length} loc/lastmod entries; expected ${expectedRouteCount}.`,
    );
  }

  if (new Set(entries.map((entry) => entry.loc)).size !== entries.length) {
    throw new Error("Sitemap locations must be unique.");
  }

  if (new Set(entries.map((entry) => entry.lastmod)).size <= 1) {
    throw new Error("Sitemap requires more than one distinct lastmod value.");
  }
}

export async function generateSitemapXml({
  routes: sitemapRoutes,
  origin = SITE_ORIGIN,
  isShallow,
  lastModified,
}: GenerateSitemapOptions): Promise<string> {
  if (await isShallow()) {
    throw new Error("Cannot generate sitemap from a shallow Git history.");
  }

  const paths = new Set<string>();
  for (const route of sitemapRoutes) {
    if (route.sources.length === 0) {
      throw new Error(
        `Cannot generate sitemap without sources for ${route.path}.`,
      );
    }
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
        `    <loc>${escapeXml(new URL(route.path, origin).toString())}</loc>`,
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

export async function writeSitemap(
  options: WriteSitemapOptions = {},
): Promise<void> {
  const repositoryRoot = getRepositoryRoot();
  const outputPath =
    options.outputPath ??
    resolve(repositoryRoot, "apps/website/public/sitemap.xml");
  const sitemapRoutes = options.routes ?? routes;
  const xml = await generateSitemapXml({
    routes: sitemapRoutes,
    isShallow: options.isShallow ?? (() => isShallowRepository(repositoryRoot)),
    lastModified:
      options.lastModified ??
      ((sources) => gitLastModified(repositoryRoot, sources)),
  });
  validateSitemapDistribution(xml, sitemapRoutes.length);
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
