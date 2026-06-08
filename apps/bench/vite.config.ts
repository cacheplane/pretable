import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**"],
    passWithNoTests: true,
    server: {
      deps: {
        // The MUI comparator adapter imports @mui/x-data-grid, which transitively
        // pulls @mui/material's ESM build (Transition.mjs). That build does a
        // directory import of `react-transition-group/TransitionGroupContext`,
        // resolvable only via the package's nested package.json redirect — a
        // bundler-only pattern Node's native ESM loader rejects ("Directory
        // import ... is not supported"). Inlining the whole @mui scope (not just
        // @mui/material — x-data-grid is the entry point) plus react-transition-
        // group routes the chain through Vite's transform pipeline, whose resolver
        // honors the redirect. MUI is a bench-only comparator, not shipped in any
        // @pretable/* package.
        inline: [/@mui\//, /react-transition-group/],
      },
    },
  },
});
