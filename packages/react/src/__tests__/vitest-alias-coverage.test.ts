import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * Every workspace package this package pulls in — directly **or through
 * another workspace package** — must be aliased to its TypeScript source in
 * `vitest.config.ts`. A workspace dep left unaliased resolves through
 * `exports` to that package's `dist/`, so a bare `vitest run` silently tests
 * whatever was built last instead of the working tree — and the failures that
 * produces read like product bugs rather than build staleness.
 *
 * Transitive, because Vite resolves the whole graph and an alias does not
 * cover what the aliased source itself imports. `@pretable/core` aliased to
 * `../core/src/index.ts` re-exports from `@pretable-internal/grid-core`, and
 * that specifier is resolved from scratch: with only the direct deps aliased,
 * every React test ran the engine's last BUILD. Measured, not theorised —
 * editing `GROUP_COLUMN_ID` in `grid-core/src` left the value React's tests
 * saw unchanged.
 *
 * Names are resolved against `packages/` rather than `node_modules`: a
 * `workspace:` range is by definition a directory in this repo, and reading
 * the symlink farm would make the check depend on install state.
 *
 * The config is read as text rather than imported: importing it would pull
 * a file outside `src/` into the typecheck program's `rootDir`. That means
 * this test only recognises the literal `"<specifier>": resolve(__dirname,
 * "<path>")` shape the config uses today; write an alias any other way and
 * this fails loudly rather than passing silently.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packagesDir = resolve(packageDir, "..");

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function readPackageJson(dir: string): PackageJson {
  return JSON.parse(
    readFileSync(resolve(dir, "package.json"), "utf8"),
  ) as PackageJson;
}

function workspaceDepsOf(dir: string): string[] {
  const json = readPackageJson(dir);
  return Object.entries({ ...json.dependencies, ...json.devDependencies })
    .filter(([, range]) => range.startsWith("workspace:"))
    .map(([name]) => name);
}

/** Package name → its directory under `packages/`. */
const packageDirsByName = new Map(
  readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(packagesDir, entry.name))
    .filter((dir) => existsSync(resolve(dir, "package.json")))
    .map((dir) => [readPackageJson(dir).name ?? "", dir] as const),
);

const workspaceDeps = (() => {
  const seen = new Set<string>();
  const pending = workspaceDepsOf(packageDir);

  while (pending.length > 0) {
    const name = pending.pop() as string;

    if (seen.has(name)) continue;
    seen.add(name);

    const dir = packageDirsByName.get(name);

    // Fail closed: a `workspace:` dep with no directory under `packages/` means
    // the layout assumption above is wrong, and every transitive dep behind it
    // has silently stopped being checked.
    if (!dir) {
      throw new Error(
        `workspace dependency "${name}" has no directory under ${packagesDir}`,
      );
    }

    pending.push(...workspaceDepsOf(dir));
  }

  return [...seen].sort();
})();

const configSource = readFileSync(
  resolve(packageDir, "vitest.config.ts"),
  "utf8",
);

const ALIAS_ENTRY = /"([^"]+)":\s*resolve\(\s*__dirname,\s*"([^"]+)"/g;

const aliases = new Map(
  [...configSource.matchAll(ALIAS_ENTRY)].map(([, specifier, target]) => [
    specifier,
    target,
  ]),
);

describe("vitest alias coverage", () => {
  test("the workspace dependency list is non-empty", () => {
    expect(workspaceDeps.length).toBeGreaterThan(0);
  });

  test("the config's alias entries were parsed", () => {
    expect(aliases.size).toBeGreaterThan(0);
  });

  test.each(workspaceDeps)("%s is aliased to its source entry", (name) => {
    const target = aliases.get(name);
    expect(
      target,
      `${name} is a workspace dependency (directly or through another workspace package) but has no resolve.alias entry in vitest.config.ts, so it resolves to dist/`,
    ).toBeDefined();
    expect(target).toMatch(/^\.\.\/[^/]+\/src\/index\.ts$/);
    expect(existsSync(resolve(packageDir, target as string))).toBe(true);
    // The entry must point at THIS package's source. A target that merely
    // looks well-formed can name a different package, which reads as covered
    // while still resolving the real one to dist/.
    expect(
      resolve(packageDir, target as string),
      `${name} is aliased to a source entry that does not belong to it`,
    ).toBe(resolve(packageDirsByName.get(name) as string, "src/index.ts"));
  });
});
