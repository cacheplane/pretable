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
    "@pretable/core": ["../core/dist/index.d.ts"],
    "@pretable/core/*": ["../core/dist/*.d.ts"],
  });
});

it("bundles all @pretable-internal/* packages via noExternal regex", async () => {
  const tsupRaw = await readFile(
    path.join(process.cwd(), "tsup.config.ts"),
    "utf8",
  );

  expect(tsupRaw).toContain("/^@pretable-internal\\//");
});

it("exposes only the root subpath export (no ./internal)", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    exports?: Record<string, unknown>;
  };

  expect(manifest.exports?.["."]).toMatchObject({
    import: "./dist/index.mjs",
    types: "./dist/index.d.ts",
  });
  expect(manifest.exports?.["./internal"]).toBeUndefined();
});
