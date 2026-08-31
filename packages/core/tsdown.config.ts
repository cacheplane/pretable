import { defineConfig } from "tsdown/config";

import { publicPackageConfig } from "../../scripts/build/tsdown-config.ts";

export default defineConfig(
  publicPackageConfig({
    alwaysBundle: [
      "@pretable-internal/calendar-date",
      "@pretable-internal/grid-core",
      "@pretable-internal/row-model",
    ],
  }),
);
