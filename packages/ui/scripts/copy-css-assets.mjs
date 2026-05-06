import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

const cssFiles = [
  ["src/themes/excel.css", "dist/themes/excel.css"],
  ["src/themes/material.css", "dist/themes/material.css"],
  ["src/grid.css", "dist/grid.css"],
  ["src/tailwind.css", "dist/tailwind.css"],
  ["src/tokens.css", "dist/tokens.css"],
];

const cssDeclaration =
  "declare const stylesheet: string;\nexport default stylesheet;\n";

for (const [source, target] of cssFiles) {
  const absoluteTarget = join(pkgDir, target);
  mkdirSync(dirname(absoluteTarget), { recursive: true });
  copyFileSync(join(pkgDir, source), absoluteTarget);
  writeFileSync(`${absoluteTarget}.d.ts`, cssDeclaration);
}
