import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { expect, it } from "vitest";

const cssExports = {
  "./themes/excel.css": {
    types: "./themes/excel.css.d.ts",
    default: "./themes/excel.css",
  },
  "./themes/material.css": {
    types: "./themes/material.css.d.ts",
    default: "./themes/material.css",
  },
  "./themes/pretable.css": {
    types: "./themes/pretable.css.d.ts",
    default: "./themes/pretable.css",
  },
  "./grid.css": {
    types: "./grid.css.d.ts",
    default: "./grid.css",
  },
  "./tailwind.css": {
    types: "./tailwind.css.d.ts",
    default: "./tailwind.css",
  },
  "./tokens.css": {
    types: "./tokens.css.d.ts",
    default: "./tokens.css",
  },
};

const cssFiles = [
  "grid.css",
  "tailwind.css",
  "tokens.css",
  "themes/excel.css",
  "themes/material.css",
  "themes/pretable.css",
];

const lintPackagingScript =
  "publint --strict && attw --pack --exclude-entrypoints ./themes/excel.css ./themes/material.css ./themes/pretable.css ./grid.css ./tailwind.css ./tokens.css";

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
  for (const value of Object.values(cssExports)) {
    expect(value.default).not.toContain("/dist/");
    expect(value.types).not.toContain("/dist/");
  }
});

it("ships one canonical root CSS tree with adjacent declarations", async () => {
  const packageRoot = process.cwd();
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    files?: string[];
    sideEffects?: string[];
  };

  expect(manifest.files).toEqual([
    "dist",
    "grid.css",
    "grid.css.d.ts",
    "tailwind.css",
    "tailwind.css.d.ts",
    "tokens.css",
    "tokens.css.d.ts",
    "themes",
  ]);
  expect(manifest.sideEffects).toEqual(["./*.css", "./themes/*.css"]);

  await Promise.all(
    cssFiles.flatMap((cssFile) => [
      access(path.join(packageRoot, cssFile)),
      access(path.join(packageRoot, `${cssFile}.d.ts`)),
    ]),
  );

  for (const directory of ["src", "dist"]) {
    const files = await readdir(path.join(packageRoot, directory), {
      recursive: true,
    });
    expect(
      files.filter((file) => file.endsWith(".css")),
      `${directory} contains a duplicate CSS source or build artifact`,
    ).toEqual([]);
  }
});

it("does not copy or generate canonical CSS during build", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  expect(manifest.scripts?.build).not.toMatch(/copy|generate|css-assets/iu);
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
