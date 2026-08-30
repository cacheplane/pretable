import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

it("resolves core declarations from explicit declaration files during the react declaration build", async () => {
  const raw = await readFile(
    path.join(process.cwd(), "tsconfig.build.json"),
    "utf8",
  );
  const config = JSON.parse(raw) as {
    compilerOptions?: {
      rootDir?: string;
      paths?: Record<string, string[]>;
    };
  };

  expect(config.compilerOptions?.paths).toMatchObject({
    "@pretable/core": ["../core/dist/index.d.mts"],
    "@pretable/core/*": ["../core/dist/*.d.mts"],
    "@pretable-internal/layout-core": ["../layout-core/src/index.ts"],
    "@pretable-internal/renderer-dom": ["../renderer-dom/src/index.ts"],
  });
});

it("bundles private workspaces and preserves every public runtime boundary", async () => {
  const config = await readFile(
    path.join(process.cwd(), "tsdown.config.ts"),
    "utf8",
  );

  expect(config).toContain("/^@pretable-internal\\//");
  expect(config).toContain("alwaysBundle");
  expect(config).toContain("neverBundle");
  for (const external of [
    '"react"',
    '"react-dom"',
    '"@pretable/core"',
    '"@pretable/ui"',
  ]) {
    expect(config).toContain(external);
  }
});

it("emits classic JSX through the stable React root boundary", async () => {
  const config = await readFile(
    path.join(process.cwd(), "tsdown.config.ts"),
    "utf8",
  );

  expect(config).toContain('runtime: "classic"');
  expect(config).toContain('pragma: "createElement"');
  expect(config).toContain('pragmaFrag: "Fragment"');
  expect(config).not.toContain("jsx-runtime");

  const lintConfig = await readFile(
    path.join(process.cwd(), "../../eslint.config.js"),
    "utf8",
  );
  expect(lintConfig).toContain('files: ["packages/react/src/**/*.tsx"]');
  expect(lintConfig).toContain("createElement|Fragment");
});

it("exposes only the root subpath export (no ./internal)", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    exports?: Record<string, unknown>;
  };

  // Dual ESM+CJS shape: nested types per condition (publint --strict requires
  // separate type declarations for ESM vs CJS resolution paths).
  expect(manifest.exports?.["."]).toMatchObject({
    import: {
      types: "./dist/index.d.mts",
      default: "./dist/index.mjs",
    },
    require: {
      types: "./dist/index.d.cts",
      default: "./dist/index.cjs",
    },
  });
  expect(manifest.exports?.["./internal"]).toBeUndefined();
});
