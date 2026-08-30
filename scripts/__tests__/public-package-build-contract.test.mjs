import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageNames = ["core", "react", "stream-adapter", "ui"];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("root pins the reviewed builder and permanent packed-consumer gate", async () => {
  const manifest = await readJson(join(root, "package.json"));
  assert.equal(manifest.devDependencies.tsdown, "0.22.14");
  assert.ok(!Object.hasOwn(manifest.devDependencies, "tsup"));
  assert.equal(
    manifest.scripts["consumer:check"],
    "node ./scripts/check-packed-consumers.mjs",
  );
});

test("one typed shared policy owns the cross-package build contract", async () => {
  const config = await readFile(
    join(root, "scripts/build/tsdown-config.ts"),
    "utf8",
  );
  assert.match(config, /defineConfig|UserConfig/u);
  assert.match(config, /["']es2018["']/iu);
  assert.match(config, /format:\s*\[[^\]]*["']esm["'][^\]]*["']cjs["']/su);
  assert.match(config, /sourcemap:\s*true/u);
  assert.match(config, /dts:\s*\{/u);
  assert.match(config, /fixedExtension:\s*true/u);
  assert.match(config, /exports:\s*false/u);
  assert.match(config, /codeSplitting:\s*false/u);
  assert.doesNotMatch(config, /workspace\s*:/u);
});

for (const packageName of packageNames) {
  test(`${packageName} owns one thin tsdown config and dual-format manifest`, async () => {
    const packageRoot = join(root, "packages", packageName);
    await access(join(packageRoot, "tsdown.config.ts"));
    await assert.rejects(
      access(join(packageRoot, "tsup.config.ts")),
      /ENOENT/u,
    );

    const config = await readFile(
      join(packageRoot, "tsdown.config.ts"),
      "utf8",
    );
    assert.match(config, /tsdown-config/u);
    assert.doesNotMatch(config, /workspace\s*:/u);
    assert.doesNotMatch(config, /packages\//u);

    const manifest = await readJson(join(packageRoot, "package.json"));
    assert.equal(manifest.scripts.build, "tsdown --config tsdown.config.ts");
    assert.match(manifest.main, /\.cjs$/u);
    assert.match(manifest.module, /\.mjs$/u);
    assert.match(manifest.types, /\.d\.mts$/u);
    assert.match(manifest.exports["."].import.types, /\.d\.mts$/u);
    assert.match(manifest.exports["."].require.types, /\.d\.cts$/u);

    const apiExtractor = await readJson(
      join(packageRoot, "api-extractor.json"),
    );
    assert.equal(
      apiExtractor.mainEntryPointFilePath,
      "<projectFolder>/dist/index.d.mts",
    );
    const docsConfig = await readFile(
      join(packageRoot, "tsconfig.docs.json"),
      "utf8",
    );
    assert.match(docsConfig, /"include":\s*\["dist\/index\.d\.mts"\]/u);
  });
}

test("the committed packed-consumer fixture map is complete", async () => {
  const fixtures = [
    "node/esm.mjs",
    "node/cjs.cjs",
    "types/public-api.tsx",
    "types/tsconfig.nodenext.json",
    "types/tsconfig.legacy.json",
    "vite/index.html",
    "vite/entry.mjs",
    "vite/vite.config.mjs",
    "webpack/entry-esm.mjs",
    "webpack/entry-cjs.cjs",
    "webpack/webpack.esm.config.cjs",
    "webpack/webpack.cjs.config.cjs",
    "framework-neutral/esm.mjs",
    "framework-neutral/cjs.cjs",
    "css/check-css.mjs",
    "deep-import/reject.mjs",
    "tree-shaking/entry.mjs",
    "tree-shaking/vite.config.mjs",
  ];
  await Promise.all(
    fixtures.map((fixture) =>
      access(join(root, "test-fixtures/packed-consumers", fixture)),
    ),
  );
});

test("public type-test configs resolve the reviewed declaration entries", async () => {
  const configPaths = [
    "type-tests/tsconfig.json",
    "type-tests/tsconfig.react.json",
    "type-tests/performance/tsconfig.100.json",
    "type-tests/performance/tsconfig.500.json",
  ];
  for (const configPath of configPaths) {
    const config = await readFile(join(root, configPath), "utf8");
    assert.doesNotMatch(
      config,
      /packages\/(?:core|react)\/dist\/index\.d\.ts/u,
    );
    assert.match(config, /packages\/(?:core|react)\/dist\/index\.d\.mts/u);
  }
});
