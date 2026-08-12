import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: { resolve: true },
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs",
  }),
  // Public bundles own one runtime copy of each private engine.
  noExternal: ["@pretable-internal/grid-core", "@pretable-internal/row-model"],
  treeshake: true,
  tsconfig: "tsconfig.build.json",
});
