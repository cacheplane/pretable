import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// Every workspace dependency is aliased to its TypeScript source, for the same
// reason `packages/react/vitest.config.ts` does it: anything left out resolves
// through `exports` to that package's `dist/`, so a bare `vitest run` would
// test the last build instead of the working tree.
//
// The transitive `@pretable-internal/*` entries are not optional. This package
// now reaches the engine through `@pretable/core` (see `src/types.ts`), and
// aliasing `@pretable/core` to source does not cover what THAT source imports —
// its re-exports of `@pretable-internal/grid-core` and
// `@pretable-internal/row-model` are resolved from scratch.
export default defineConfig({
  resolve: {
    alias: {
      "@pretable/core": resolve(__dirname, "../core/src/index.ts"),
      "@pretable-internal/grid-core": resolve(
        __dirname,
        "../grid-core/src/index.ts",
      ),
      "@pretable-internal/layout-core": resolve(
        __dirname,
        "../layout-core/src/index.ts",
      ),
      "@pretable-internal/row-model": resolve(
        __dirname,
        "../row-model/src/index.ts",
      ),
      "@pretable-internal/text-core": resolve(
        __dirname,
        "../text-core/src/index.ts",
      ),
    },
  },
});
