import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pretable/core": resolve(__dirname, "../core/src/index.ts"),
      "@pretable-internal/renderer-dom": resolve(
        __dirname,
        "../renderer-dom/src/index.ts",
      ),
    },
  },
});
