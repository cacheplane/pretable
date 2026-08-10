import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// Every workspace dependency of this package is aliased to its TypeScript
// source. Anything left out resolves through `exports` to that package's
// `dist/`, so a bare `vitest run` would test the last build instead of the
// working tree. `src/__tests__/vitest-alias-coverage.test.ts` pins this.
export default defineConfig({
  resolve: {
    alias: {
      "@pretable/core": resolve(__dirname, "../core/src/index.ts"),
      "@pretable/ui": resolve(__dirname, "../ui/src/index.ts"),
      "@pretable-internal/renderer-dom": resolve(
        __dirname,
        "../renderer-dom/src/index.ts",
      ),
      "@pretable-internal/scenario-data": resolve(
        __dirname,
        "../scenario-data/src/index.ts",
      ),
    },
  },
});
