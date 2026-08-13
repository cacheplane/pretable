import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

/**
 * A per-build identity, so a run can prove WHICH build it measured.
 *
 * The bench's numbers are only worth anything if they describe a known commit.
 * They silently stopped doing that: with a second worktree holding port 4173,
 * `bench:matrix` printed `Error: Port 4173 is already in use` and then ran the
 * whole suite against that other branch's `vite preview`, writing artifacts as
 * if nothing were wrong. Post-fix runs read as failures because they were
 * measuring pre-fix code.
 *
 * A git SHA cannot do this job: the working tree is dirty for most of a
 * development loop, so the SHA is identical across builds that differ. A fresh
 * id per build is exactly the question being asked — "is the server answering
 * me the one I just built?" — and it also catches a stale `dist/` and a
 * forgotten rebuild, which have both bitten this repo.
 *
 * Written to `dist/` so the test can read the id it expects off disk, and
 * injected into the bundle so the page can report the id it actually is.
 */
const BUILD_ID = randomUUID();
const BUILD_ID_FILE = "bench-build-id.txt";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "bench-build-id",
      apply: "build",
      writeBundle(options) {
        const dir = options.dir ?? path.join(import.meta.dirname, "dist");
        fs.writeFileSync(path.join(dir, BUILD_ID_FILE), BUILD_ID, "utf8");
      },
    },
  ],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.VITE_BENCH_BUILD_ID": JSON.stringify(BUILD_ID),
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
