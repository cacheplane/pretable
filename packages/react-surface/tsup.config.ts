import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm"],
  treeshake: true,
});
