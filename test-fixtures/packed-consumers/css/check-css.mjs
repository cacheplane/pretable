import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@pretable/ui/package.json"));
const assets = [
  "grid.css",
  "tailwind.css",
  "tokens.css",
  "themes/excel.css",
  "themes/material.css",
  "themes/pretable.css",
];

for (const asset of assets) {
  const cssPath = join(packageRoot, asset);
  const declarationPath = `${cssPath}.d.ts`;
  assert.equal(
    require.resolve(`@pretable/ui/${asset}`),
    cssPath,
    `${asset} must resolve through its public package export`,
  );
  await Promise.all([access(cssPath), access(declarationPath)]);
  const [css, declaration] = await Promise.all([
    readFile(cssPath, "utf8"),
    readFile(declarationPath, "utf8"),
  ]);
  assert.ok(css.length > 20, `${asset} must not be empty`);
  assert.match(
    declaration,
    /declare module|export/u,
    `${asset}.d.ts must declare the CSS module`,
  );
  for (const match of css.matchAll(/@import\s+["'](\.[^"']+)["']/gu)) {
    await access(join(dirname(cssPath), match[1]));
  }
}
