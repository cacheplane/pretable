import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

it("publishes distinct ESM and CommonJS declarations", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
    main?: string;
    module?: string;
    types?: string;
  };

  expect(manifest).toMatchObject({
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.mts",
  });
  expect(manifest.exports?.["."]).toMatchObject({
    import: { default: "./dist/index.mjs", types: "./dist/index.d.mts" },
    require: { default: "./dist/index.cjs", types: "./dist/index.d.cts" },
  });
});

it("bundles the three private engine packages", async () => {
  const config = await readFile(
    path.join(process.cwd(), "tsdown.config.ts"),
    "utf8",
  );
  expect(config).toContain('"@pretable-internal/calendar-date"');
  expect(config).toContain('"@pretable-internal/grid-core"');
  expect(config).toContain('"@pretable-internal/row-model"');
  expect(config).toContain("alwaysBundle");
  expect(config).not.toContain("neverBundle");
});
