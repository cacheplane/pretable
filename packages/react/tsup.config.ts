import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: { resolve: true },
  entry: ["src/index.ts"],
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs",
  }),
  noExternal: [/^@pretable-internal\//],
  treeshake: true,
  tsconfig: "tsconfig.build.json",
});
