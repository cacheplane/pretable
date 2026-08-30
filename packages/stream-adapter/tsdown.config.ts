import { defineConfig } from "tsdown/config";

import { publicPackageConfig } from "../../scripts/build/tsdown-config.ts";

export default defineConfig(
  publicPackageConfig({
    neverBundle: ["@cacheplane/json-stream"],
  }),
);
