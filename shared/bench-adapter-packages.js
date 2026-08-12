import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which npm packages define what each bench adapter actually measured.
 *
 * A comparative benchmark number is a claim about a *version* of the
 * comparator, and until 2026-08 no artifact recorded one. Three comparator
 * majors landed on top of the May 2026 comparative runset — ag-grid 33 -> 35
 * (#162) -> 36 (#306) and @mui/x-data-grid 7 -> 8 (#162) -> 9 (#150) — and
 * none of those PRs re-measured or marked the numbers invalidated, because
 * nothing in the evidence format could tell that they had gone stale.
 *
 * The map is deliberately more than the one headline package per adapter: the
 * MUI DataGrid renders through `@mui/material`, and TanStack Table only
 * virtualizes because of `@tanstack/react-virtual`. A major on either moves the
 * measurement as surely as one on the grid package itself.
 *
 * Keep in sync with `benchAdapterFamilies` in ./bench-adapter-families.js — the
 * two maps must cover exactly the same adapter ids, which
 * `scripts/__tests__/bench-comparator-provenance.test.mjs` asserts.
 *
 * @type {Record<string, readonly string[]>}
 */
export const benchAdapterPackages = {
  pretable: ["@pretable/react", "@pretable/ui", "@pretable/stream-adapter"],
  "ag-grid": ["ag-grid-community", "ag-grid-react"],
  tanstack: ["@tanstack/react-table", "@tanstack/react-virtual"],
  mui: ["@mui/x-data-grid", "@mui/material"],
};

/**
 * Adapters whose DOM and behaviour belong to a third party. These are the
 * control side of every comparative claim, so their versions are the ones a
 * committed number is checked against. `pretable` is excluded on purpose: its
 * version moves on every release, and pinning committed evidence to it would
 * turn each release into a failing check rather than a signal about the
 * comparator.
 *
 * @type {readonly string[]}
 */
export const benchComparatorAdapterIds = Object.keys(benchAdapterPackages)
  .filter((adapterId) => adapterId !== "pretable")
  .sort();

/** Repo root, resolved from this file so callers need no cwd assumption. */
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Where installed manifests are read from. `apps/bench` is the only workspace
 * that depends on every comparator, so its `node_modules` is the resolution
 * root — the same tree the bench app imports from when it runs.
 */
export const BENCH_APP_DIR = path.join(REPO_ROOT, "apps", "bench");

/**
 * Read one package's *resolved* version from the manifest pnpm installed.
 *
 * The installed manifest, not the lockfile and never a hand-typed string: a
 * lockfile entry can disagree with what is on disk, and a hand-typed version is
 * exactly the thing that was missing. `createRequire(...).resolve()` is not
 * usable here — `ag-grid-community` has an `exports` map with no
 * `./package.json` entry, so resolution throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 *
 * Fails closed: an unreadable or version-less manifest throws, so a run cannot
 * produce a summary that silently omits provenance.
 *
 * @param {string} packageName
 * @param {{ benchAppDir?: string }} [options]
 * @returns {string}
 */
export function readInstalledPackageVersion(packageName, options = {}) {
  const benchAppDir = options.benchAppDir ?? BENCH_APP_DIR;
  const manifestPath = path.join(
    benchAppDir,
    "node_modules",
    ...packageName.split("/"),
    "package.json",
  );

  let raw;

  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (cause) {
    throw new Error(
      `Cannot read the installed manifest for "${packageName}" at ${manifestPath}. ` +
        `Run \`pnpm install\` before a bench run — a run that cannot resolve its ` +
        `comparator versions must not write an artifact.`,
      { cause },
    );
  }

  const version = JSON.parse(raw).version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error(
      `The installed manifest for "${packageName}" (${manifestPath}) has no version field.`,
    );
  }

  return version;
}

/**
 * Resolved versions for one adapter, as `{ packageName: version }`.
 *
 * @param {string} adapterId
 * @param {{ benchAppDir?: string }} [options]
 * @returns {Record<string, string>}
 */
export function readAdapterVersions(adapterId, options = {}) {
  const packages = benchAdapterPackages[adapterId];

  if (!packages) {
    throw new Error(
      `Unknown bench adapter "${adapterId}". Add it to benchAdapterPackages in ` +
        `shared/bench-adapter-packages.js (and to benchAdapterFamilies next to it) ` +
        `so its comparative numbers carry a version.`,
    );
  }

  return Object.fromEntries(
    packages.map((packageName) => [
      packageName,
      readInstalledPackageVersion(packageName, options),
    ]),
  );
}

/**
 * The provenance block a bench artifact carries.
 *
 * Written by the two Node-side writers — `apps/bench/tests/bench.spec.ts` for
 * per-run `.summary.json` files and `scripts/bench-matrix.mjs` for the
 * hypothesis report — because the measurement itself runs in the browser and
 * cannot read a manifest. Same key, same shape in both, which is what lets one
 * guard read every artifact.
 *
 * @param {readonly string[]} adapterIds
 * @param {{ benchAppDir?: string, recordedAt?: string }} [options]
 * @returns {{ source: string, recordedAt: string, adapters: Record<string, Record<string, string>> }}
 */
export function createAdapterVersionsRecord(adapterIds, options = {}) {
  const sorted = [...new Set(adapterIds)].sort();

  return {
    source: "installed package manifests under apps/bench/node_modules",
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    adapters: Object.fromEntries(
      sorted.map((adapterId) => [
        adapterId,
        readAdapterVersions(adapterId, options),
      ]),
    ),
  };
}
