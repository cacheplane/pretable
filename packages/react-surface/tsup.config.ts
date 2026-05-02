import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm"],
  noExternal: ["@pretable-internal/renderer-dom"],
  treeshake: true,
});
