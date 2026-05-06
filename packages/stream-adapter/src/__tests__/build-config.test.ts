import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

it("publishes dual ESM and CJS entrypoints with matching declarations", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    exports?: Record<string, unknown>;
    main?: string;
    module?: string;
    types?: string;
  };

  expect(manifest).toMatchObject({
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
  });
  expect(manifest.exports?.["."]).toMatchObject({
    import: {
      types: "./dist/index.d.ts",
      default: "./dist/index.mjs",
    },
    require: {
      types: "./dist/index.d.cts",
      default: "./dist/index.cjs",
    },
  });
});

it("exposes a packaging lint script for CI and release checks", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    scripts?: Record<string, string>;
  };

  expect(manifest.scripts?.["lint:packaging"]).toBe(
    "publint --strict && attw --pack",
  );
});
