import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * Every workspace package this package depends on must be aliased to its
 * TypeScript source in `vitest.config.ts`. A workspace dep left unaliased
 * resolves through `exports` to that package's `dist/`, so a bare
 * `vitest run` silently tests whatever was built last instead of the
 * working tree — and the failures that produces read like product bugs
 * rather than build staleness.
 *
 * The config is read as text rather than imported: importing it would pull
 * a file outside `src/` into the typecheck program's `rootDir`. That means
 * this test only recognises the literal `"<specifier>": resolve(__dirname,
 * "<path>")` shape the config uses today; write an alias any other way and
 * this fails loudly rather than passing silently.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const packageJson = JSON.parse(
  readFileSync(resolve(packageDir, "package.json"), "utf8"),
) as PackageJson;

const workspaceDeps = Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
})
  .filter(([, range]) => range.startsWith("workspace:"))
  .map(([name]) => name)
  .sort();

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
      `${name} is a workspace dependency but has no resolve.alias entry in vitest.config.ts, so it resolves to dist/`,
    ).toBeDefined();
    expect(target).toMatch(/^\.\.\/[^/]+\/src\/index\.ts$/);
    expect(existsSync(resolve(packageDir, target as string))).toBe(true);
  });
});
