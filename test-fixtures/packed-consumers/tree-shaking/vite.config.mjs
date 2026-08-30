import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "entry.mjs"),
      fileName: () => "tree-shaking.mjs",
      formats: ["es"],
    },
    minify: false,
    outDir: "dist",
    sourcemap: true,
    target: "es2018",
  },
});
