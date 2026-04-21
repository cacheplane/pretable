import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  external: ["react", "react-dom"],
  format: ["esm"],
  onSuccess:
    "cp src/tokens.css dist/tokens.css && cp src/components.css dist/components.css",
});
