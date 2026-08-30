import { defineConfig } from "tsdown/config";

import { publicPackageConfig } from "../../scripts/build/tsdown-config.ts";

export default defineConfig(
  publicPackageConfig({
    alwaysBundle: [/^@pretable-internal\//],
    inputOptions: {
      transform: {
        jsx: {
          runtime: "classic",
          pragma: "createElement",
          pragmaFrag: "Fragment",
        },
      },
    },
    neverBundle: ["react", "react-dom", "@pretable/core", "@pretable/ui"],
  }),
);
