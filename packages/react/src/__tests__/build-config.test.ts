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

  expect(config.compilerOptions?.rootDir).toBe("src");
  expect(config.compilerOptions?.paths).toMatchObject({
    "@pretable/core": ["../core/dist/index.d.ts"],
    "@pretable/core/*": ["../core/dist/*.d.ts"],
  });
});

it("declares an internal package subpath for the shared renderer seam", async () => {
  const [manifestRaw, tsupRaw] = await Promise.all([
    readFile(path.join(process.cwd(), "package.json"), "utf8"),
    readFile(path.join(process.cwd(), "tsup.config.ts"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw) as {
    exports?: Record<string, { import?: string; types?: string }>;
  };

  expect(manifest.exports?.["./internal"]).toMatchObject({
    import: "./dist/internal.js",
    types: "./dist/internal.d.ts",
  });
  expect(tsupRaw).toContain('"src/internal.ts"');
});
