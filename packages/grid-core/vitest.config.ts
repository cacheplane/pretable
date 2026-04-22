import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pretable-internal/layout-core": resolve(
        __dirname,
        "../layout-core/src/index.ts",
      ),
      "@pretable-internal/text-core": resolve(
        __dirname,
        "../text-core/src/index.ts",
      ),
    },
  },
});
