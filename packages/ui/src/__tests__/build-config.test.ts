import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

const cssExports = {
  "./themes/excel.css": {
    types: "./dist/themes/excel.css.d.ts",
    default: "./dist/themes/excel.css",
  },
  "./themes/material.css": {
    types: "./dist/themes/material.css.d.ts",
    default: "./dist/themes/material.css",
  },
  "./grid.css": {
    types: "./dist/grid.css.d.ts",
    default: "./dist/grid.css",
  },
  "./tailwind.css": {
    types: "./dist/tailwind.css.d.ts",
    default: "./dist/tailwind.css",
  },
  "./tokens.css": {
    types: "./dist/tokens.css.d.ts",
    default: "./dist/tokens.css",
  },
};

const lintPackagingScript =
  "publint --strict && attw --pack --exclude-entrypoints ./themes/excel.css ./themes/material.css ./grid.css ./tailwind.css ./tokens.css";

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

it("publishes typed CSS subpath exports", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    exports?: Record<string, unknown>;
  };

  expect(manifest.exports).toMatchObject(cssExports);
});

it("exposes a packaging lint script for CI and release checks", async () => {
  const manifestRaw = await readFile(
    path.join(process.cwd(), "package.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw) as {
    scripts?: Record<string, string>;
  };

  expect(manifest.scripts?.["lint:packaging"]).toBe(lintPackagingScript);
});
