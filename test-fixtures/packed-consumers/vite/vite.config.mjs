import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: true,
    target: "es2018",
  },
});
