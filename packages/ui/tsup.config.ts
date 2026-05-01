import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { defineConfig } from "tsup";

const pkgDir = dirname(fileURLToPath(import.meta.url));

const copyCssCommand = [
  `mkdir -p ${join(pkgDir, "dist/themes")}`,
  `cp ${join(pkgDir, "src/themes/excel.css")} ${join(pkgDir, "dist/themes/excel.css")}`,
  `cp ${join(pkgDir, "src/themes/material.css")} ${join(pkgDir, "dist/themes/material.css")}`,
  `cp ${join(pkgDir, "src/grid.css")} ${join(pkgDir, "dist/grid.css")}`,
  `cp ${join(pkgDir, "src/tailwind.css")} ${join(pkgDir, "dist/tailwind.css")}`,
].join(" && ");

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  onSuccess: copyCssCommand,
});
