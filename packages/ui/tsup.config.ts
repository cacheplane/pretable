import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { defineConfig } from "tsup";

const pkgDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  external: ["react", "react-dom"],
  format: ["esm"],
  onSuccess: `cp ${join(pkgDir, "src/tokens.css")} ${join(pkgDir, "dist/tokens.css")} && cp ${join(pkgDir, "src/components.css")} ${join(pkgDir, "dist/components.css")}`,
});
