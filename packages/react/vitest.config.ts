import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// Every workspace dependency of this package is aliased to its TypeScript
// source. Anything left out resolves through `exports` to that package's
// `dist/`, so a bare `vitest run` would test the last build instead of the
// working tree. `src/__tests__/vitest-alias-coverage.test.ts` pins this.
//
// The transitive ones are not optional: aliasing `@pretable/core` to source
// does not cover what that source imports, and its re-export of
// `@pretable-internal/grid-core` is resolved from scratch. Without the entry
// below, every test in this package exercised the engine's last build.
export default defineConfig({
  resolve: {
    alias: {
      "@pretable/core": resolve(__dirname, "../core/src/index.ts"),
      "@pretable/ui": resolve(__dirname, "../ui/src/index.ts"),
      "@pretable-internal/grid-core": resolve(
        __dirname,
        "../grid-core/src/index.ts",
      ),
      "@pretable-internal/layout-core": resolve(
        __dirname,
        "../layout-core/src/index.ts",
      ),
      "@pretable-internal/renderer-dom": resolve(
        __dirname,
        "../renderer-dom/src/index.ts",
      ),
      "@pretable-internal/scenario-data": resolve(
        __dirname,
        "../scenario-data/src/index.ts",
      ),
      "@pretable-internal/text-core": resolve(
        __dirname,
        "../text-core/src/index.ts",
      ),
    },
  },
});
