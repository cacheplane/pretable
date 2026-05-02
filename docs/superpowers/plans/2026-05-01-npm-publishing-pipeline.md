# NPM Publishing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@pretable/core`, `@pretable/react`, and `@cacheplane/json-stream` to npm as version `0.0.1` via a `changesets/action@v1`-driven release workflow with provenance, after extracting the React surface seam into a private workspace package and switching public-package builds to dual ESM+CJS with type bundling.

**Architecture:** Extract internal seam to new private package `@pretable-internal/react-surface` (preserves measurement integrity by keeping a single source of truth); update three public packages to dual ESM+CJS with `tsup`'s `dts: true`; bundle internal deps via `tsup`'s `noExternal`; move bundled internal deps to `devDependencies` so the published manifest doesn't reference unpublishable workspace versions; add `publint --strict && attw --pack` verification matching GridBeta Query's pattern; add `release.yml` that runs `changesets/action@v1` with auto-merge of the Version Packages PR and provenance attestation.

**Tech Stack:** TypeScript, pnpm 10 workspaces, tsup (with rollup-plugin-dts internally), changesets, `@arethetypeswrong/cli`, `publint`, `@svitejs/changesets-changelog-github-compact`, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md](../specs/2026-05-01-npm-publishing-pipeline-design.md)

**Reference:** GridBeta Query's per-package `test:build` script; Dawn's `release.yml`; the AAF `publish.yml` for trusted-publishing intent.

---

## Phase 1 — Extract `@pretable-internal/react-surface`

CI stays green throughout. No code logic changes; only file moves and import-path updates.

### Task 1: Scaffold `packages/react-surface/`

**Files:**

- Create: `packages/react-surface/package.json`
- Create: `packages/react-surface/tsconfig.json`
- Create: `packages/react-surface/tsconfig.build.json`
- Create: `packages/react-surface/tsconfig.typecheck.json`
- Create: `packages/react-surface/tsup.config.ts`
- Create: `packages/react-surface/src/.gitkeep`

- [ ] **Step 1: Create the package directory.**

```bash
mkdir -p packages/react-surface/src/__tests__
touch packages/react-surface/src/.gitkeep
```

- [ ] **Step 2: Write `packages/react-surface/package.json`.**

```jsonc
{
  "name": "@pretable-internal/react-surface",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "files": ["dist"],
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
    },
  },
  "peerDependencies": {
    "react": "^19.0.0",
  },
  "dependencies": {
    "@pretable/core": "workspace:*",
    "@pretable-internal/scenario-data": "workspace:*",
    "@pretable-internal/renderer-dom": "workspace:*",
  },
  "scripts": {
    "build": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsup",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && vitest run --environment jsdom",
    "typecheck": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsc -p tsconfig.typecheck.json --noEmit",
  },
}
```

- [ ] **Step 3: Write `packages/react-surface/tsconfig.json`.**

Copy from `packages/react/tsconfig.json` and adjust paths. Open `packages/react/tsconfig.json` to see the exact shape; the new file should extend `../../tsconfig.react.json` (the workspace's React-flavored base) the same way.

```jsonc
{
  "extends": "../../tsconfig.react.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/__tests__/**", "node_modules", "dist"],
}
```

- [ ] **Step 4: Write `packages/react-surface/tsconfig.build.json`.**

Copy the shape from `packages/react/tsconfig.build.json`.

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": false,
    "noEmit": false,
  },
}
```

- [ ] **Step 5: Write `packages/react-surface/tsconfig.typecheck.json`.**

```jsonc
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*", "src/**/__tests__/**"],
}
```

- [ ] **Step 6: Write `packages/react-surface/tsup.config.ts`.**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm"],
  treeshake: true,
});
```

- [ ] **Step 7: Verify pnpm sees the new package.**

```bash
pnpm install
pnpm list -r --filter @pretable-internal/react-surface
```

Expected: workspace lists the new package at version 0.0.0.

- [ ] **Step 8: Commit.**

```bash
git add packages/react-surface/
git commit -m "scaffold(react-surface): create empty @pretable-internal/react-surface package"
```

### Task 2: Move source files from `packages/react/src/internal/` to `packages/react-surface/src/`

**Files:**

- Move: `packages/react/src/internal.ts` → `packages/react-surface/src/index.ts`
- Move: `packages/react/src/internal/inspection-grid.tsx` → `packages/react-surface/src/inspection-grid.tsx`
- Move: `packages/react/src/internal/labeled-grid-surface.tsx` → `packages/react-surface/src/labeled-grid-surface.tsx`
- Move: `packages/react/src/internal/pretable-surface.tsx` → `packages/react-surface/src/pretable-surface.tsx`
- Move: `packages/react/src/internal/rendering.ts` → `packages/react-surface/src/rendering.ts`
- Move: `packages/react/src/internal/styles.ts` → `packages/react-surface/src/styles.ts`
- Move: `packages/react/src/internal/__tests__/` → `packages/react-surface/src/__tests__/`

- [ ] **Step 1: Delete the placeholder.**

```bash
rm packages/react-surface/src/.gitkeep
```

- [ ] **Step 2: Move source files using `git mv` (preserves history).**

```bash
git mv packages/react/src/internal.ts                      packages/react-surface/src/index.ts
git mv packages/react/src/internal/inspection-grid.tsx     packages/react-surface/src/inspection-grid.tsx
git mv packages/react/src/internal/labeled-grid-surface.tsx packages/react-surface/src/labeled-grid-surface.tsx
git mv packages/react/src/internal/pretable-surface.tsx    packages/react-surface/src/pretable-surface.tsx
git mv packages/react/src/internal/rendering.ts            packages/react-surface/src/rendering.ts
git mv packages/react/src/internal/styles.ts               packages/react-surface/src/styles.ts
git mv packages/react/src/internal/__tests__               packages/react-surface/src/__tests__
rmdir packages/react/src/internal
```

- [ ] **Step 3: Update import paths inside `packages/react-surface/src/index.ts`.**

The old file (`internal.ts`) had paths like `./internal/pretable-surface`. After the move, those should be `./pretable-surface`.

```bash
# Inspect the file
cat packages/react-surface/src/index.ts
```

Apply edits so each `./internal/X` becomes `./X`. The file should look like:

```typescript
export { InspectionGrid } from "./inspection-grid";
export { PretableSurface } from "./pretable-surface";
export { LabeledGridSurface } from "./labeled-grid-surface";
export type {} from /* existing types */ "...";
export type { InspectionGridProps } from "./inspection-grid";
export type { PretableSurfaceProps } from "./pretable-surface";
export type { PretableTelemetry } from "./use-pretable"; // ← STALE
```

The last line is a problem — `use-pretable.ts` lives in `packages/react/src/`, not in this package. Fix in next step.

- [ ] **Step 4: Resolve cross-package type re-exports.**

Decision: `PretableTelemetry` belongs in `react-surface` (it describes the telemetry surface emitted by `PretableSurface`), so move its definition.

```bash
# Find the type definition
grep -n "export type PretableTelemetry\|interface PretableTelemetry" packages/react/src/use-pretable.ts
grep -n "PretableTelemetry" packages/react-surface/src/pretable-surface.tsx
```

If `PretableTelemetry` is defined in `packages/react/src/use-pretable.ts`:

1. Move its definition to `packages/react-surface/src/index.ts` (or to `pretable-surface.tsx` if more natural).
2. Update `packages/react/src/use-pretable.ts` to import the type from `@pretable-internal/react-surface`.
3. Update `packages/react-surface/src/index.ts` to export it from its new home.

If it's defined inside `pretable-surface.tsx` already, no move needed — just update the re-export in `index.ts`:

```typescript
export type { PretableTelemetry } from "./pretable-surface";
```

- [ ] **Step 5: Move two more files into `react-surface` because the internal seam depends on them.**

Moved files in Step 2 still have `../` imports that point outside the new package:

- `pretable-surface.tsx`: imports `measureRenderedRowHeight` from `../row-height`, and `usePretableModel` + `PretableTelemetry` from `../use-pretable`.
- `labeled-grid-surface.tsx`, `inspection-grid.tsx`: import type `PretableTelemetry` from `../use-pretable`.

`row-height.ts` and `use-pretable.ts` therefore must move into `react-surface` too. Both are publicly exported from `@pretable/react`'s `index.ts`; the public package will re-export them from `@pretable-internal/react-surface`.

```bash
git mv packages/react/src/row-height.ts   packages/react-surface/src/row-height.ts
git mv packages/react/src/use-pretable.ts packages/react-surface/src/use-pretable.ts
```

Update the import paths inside the freshly-moved `internal/`-origin files:

- In `packages/react-surface/src/pretable-surface.tsx`:
  - `from "../row-height"` → `from "./row-height"`
  - `from "../use-pretable"` → `from "./use-pretable"`
- In `packages/react-surface/src/labeled-grid-surface.tsx`:
  - `from "../use-pretable"` → `from "./use-pretable"`
- In `packages/react-surface/src/inspection-grid.tsx`:
  - `from "../use-pretable"` → `from "./use-pretable"`
- In `packages/react-surface/src/__tests__/pretable-surface.test.tsx`:
  - `from "../../row-height"` → `from "../row-height"`
  - `from "../../use-pretable"` → `from "../use-pretable"`

Verify zero `../` imports remain (other than `__tests__` references to peer source which are fine):

```bash
grep -rn 'from "\.\./' packages/react-surface/src/
```

Expected: only `__tests__/X.test.tsx` lines that import their corresponding peer (`../inspection-grid`, `../labeled-grid-surface`, etc.) — those are the test→source siblings and are correct.

Cross-check that `packages/react-surface/src/` now imports only:

- `./<peer>` (siblings)
- `react`
- `@pretable/core`
- `@pretable-internal/scenario-data`
- `@pretable-internal/renderer-dom`

```bash
grep -hE '^import.*from\s*"' packages/react-surface/src/*.{ts,tsx} | grep -oE 'from\s*"[^"]+"' | sort -u
```

Expected: only the five categories above.

- [ ] **Step 6: Build `react-surface` standalone.**

```bash
pnpm --filter @pretable-internal/react-surface build
```

Expected: tsup emits `packages/react-surface/dist/index.{js,d.ts}` with no errors.

- [ ] **Step 7: Run `react-surface` tests standalone.**

```bash
pnpm --filter @pretable-internal/react-surface test
```

Expected: all the migrated tests pass.

- [ ] **Step 8: Commit.**

```bash
git add packages/react-surface/ packages/react/
git commit -m "refactor(react-surface): move internal seam to its own private package"
```

### Task 3: Update `packages/react/`'s direct consumers of moved code

**Files:**

- Modify: `packages/react/src/pretable.tsx`
- Modify: `packages/react/src/index.ts` (if `row-height`, `use-pretable`, etc. moved into react-surface and need re-export)
- Modify: `packages/react/package.json`
- Modify: `packages/react/tsup.config.ts`

- [ ] **Step 1: Update `packages/react/src/pretable.tsx`.**

```bash
# Show current import
grep "PretableSurface" packages/react/src/pretable.tsx
```

Change:

```typescript
import { PretableSurface } from "./internal/pretable-surface";
```

to:

```typescript
import { PretableSurface } from "@pretable-internal/react-surface";
```

- [ ] **Step 2: Update `packages/react/src/index.ts` to re-export migrated public symbols from `@pretable-internal/react-surface`.**

Both `row-height.ts` and `use-pretable.ts` moved out of `packages/react/src/` in Task 2 Step 5. Their publicly-exported members must be re-exported from `index.ts` so the public API surface stays identical:

```typescript
// packages/react/src/index.ts

export { Pretable } from "./pretable";
export { measureRenderedRowHeight } from "@pretable-internal/react-surface";
export {
  usePretable,
  usePretableModel,
  // ...any other public symbols previously re-exported from "./use-pretable"
} from "@pretable-internal/react-surface";
export type {} from // ...preserve all type re-exports from the original index.ts,
// now sourced from @pretable-internal/react-surface
"@pretable-internal/react-surface";
```

Compare the diff against the pre-move `packages/react/src/index.ts` to confirm every public symbol still appears.

```bash
git show HEAD~2:packages/react/src/index.ts
```

(The `HEAD~2` reaches before Task 2's commits.) Confirm every name on the left also appears on the right.

- [ ] **Step 3: Update `packages/react/package.json` dependencies.**

```jsonc
{
  "dependencies": {
    "@pretable/core": "workspace:*",
  },
  "devDependencies": {
    "@pretable-internal/react-surface": "workspace:*",
    "@pretable-internal/scenario-data": "workspace:*",
    "@pretable-internal/renderer-dom": "workspace:*",
    // ... existing devDependencies (test runners, etc.) preserved
  },
}
```

Critical: `@pretable-internal/react-surface`, `@pretable-internal/scenario-data`, and `@pretable-internal/renderer-dom` go in **`devDependencies`**, not `dependencies`. They will be inlined by tsup's `noExternal`; the published manifest must not reference them.

- [ ] **Step 4: Drop `./internal` from `packages/react/package.json` `exports`.**

```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
    },
    // "./internal" entry removed
  },
}
```

- [ ] **Step 5: Update `packages/react/tsup.config.ts`.**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false, // updated in Phase 2 Task 6
  entry: ["src/index.ts"], // ← removed src/internal.ts
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm"],
  noExternal: [/^@pretable-internal\//],
  treeshake: true,
});
```

(Phase 2 will switch `format` to `["esm","cjs"]` and `dts` to `true`. For now, only the entry change matters.)

- [ ] **Step 6: Re-run pnpm install to apply dependency rearrangement.**

```bash
pnpm install
```

- [ ] **Step 7: Build `@pretable/react`.**

```bash
pnpm --filter @pretable/react build
```

Expected: tsup emits `packages/react/dist/index.js` with no errors. The bundle should NOT contain references to `@pretable-internal/*` (they're inlined). Quick check:

```bash
grep '@pretable-internal' packages/react/dist/index.js | head
```

Expected: zero matches. (`@pretable/core` may appear because it's external.)

- [ ] **Step 8: Run `@pretable/react` tests.**

```bash
pnpm --filter @pretable/react test
```

Expected: all tests pass. Tests that previously imported from `./internal` may need import updates if they exist in `packages/react/src/__tests__/`. Apply the same `@pretable-internal/react-surface` substitution.

- [ ] **Step 9: Commit.**

```bash
git add packages/react/
git commit -m "refactor(react): consume react-surface as workspace dependency"
```

### Task 4: Update workspace consumers (bench, website, streaming-demo)

**Files:**

- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/bench/src/bench-runtime.ts`
- Modify: `apps/bench/src/bench-app.tsx`
- Modify: `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `apps/bench/package.json`
- Modify: `apps/website/app/components/PlaygroundSection.tsx`
- Modify: `apps/website/package.json`
- Modify: `apps/streaming-demo/src/components/streaming-grid.tsx`
- Modify: `apps/streaming-demo/package.json`

- [ ] **Step 1: Find and replace import strings across consumers.**

```bash
grep -rln '@pretable/react/internal' apps/ | grep -v node_modules
```

Expected: 4-6 files listed.

For each file, replace `@pretable/react/internal` with `@pretable-internal/react-surface`. Both type imports and value imports.

```bash
# Example using sed (verify after with grep):
for f in apps/bench/src/pretable-adapter.tsx \
         apps/bench/src/bench-runtime.ts \
         apps/bench/src/bench-app.tsx \
         apps/bench/src/__tests__/pretable-adapter.test.tsx \
         apps/website/app/components/PlaygroundSection.tsx \
         apps/streaming-demo/src/components/streaming-grid.tsx; do
  [ -f "$f" ] && sed -i '' 's|@pretable/react/internal|@pretable-internal/react-surface|g' "$f"
done

# Verify no leftover references
grep -rn '@pretable/react/internal' apps/ | grep -v node_modules
```

Expected last grep: zero matches.

- [ ] **Step 2: Update each app's `package.json` dependencies.**

For `apps/bench/package.json`, `apps/website/package.json`, `apps/streaming-demo/package.json`:

- Add to `dependencies`: `"@pretable-internal/react-surface": "workspace:*"`
- Drop the workspace dep on anything that was reached only via `@pretable/react/internal` (review the diff carefully — most apps still need direct deps on `@pretable/core`, `@pretable/react`, etc.).

- [ ] **Step 3: Re-run pnpm install.**

```bash
pnpm install
```

- [ ] **Step 4: Build the bench app.**

```bash
pnpm --filter @pretable/app-bench build
```

Expected: build succeeds; no module-not-found errors.

- [ ] **Step 5: Run bench app tests.**

```bash
pnpm --filter @pretable/app-bench test
```

Expected: tests pass.

- [ ] **Step 6: Build the website app.**

```bash
pnpm --filter @pretable/app-website build
```

Expected: Next.js build succeeds.

- [ ] **Step 7: Run website tests.**

```bash
pnpm --filter @pretable/app-website test
```

Expected: 38+ tests pass.

- [ ] **Step 8: Commit.**

```bash
git add apps/
git commit -m "refactor(apps): consume react-surface from internal package"
```

### Task 5: Full-workspace verification gate

- [ ] **Step 1: Run all workspace tests.**

```bash
pnpm test
```

Expected: all packages pass.

- [ ] **Step 2: Run all workspace typechecks.**

```bash
pnpm typecheck
```

Expected: no type errors anywhere.

- [ ] **Step 3: Run all workspace lints.**

```bash
pnpm lint
```

Expected: clean (or pre-existing warnings only).

- [ ] **Step 4: Run all workspace builds.**

```bash
pnpm build
```

Expected: every package builds.

- [ ] **Step 5: Format check.**

```bash
pnpm format
```

Expected: clean. Run `pnpm format:write` if it isn't.

- [ ] **Step 6: Run a smoke bench to confirm runtime behavior.**

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Expected: `1 passed`. Confirms the bench's `PretableSurface` import (now from `@pretable-internal/react-surface`) renders correctly.

- [ ] **Step 7: Commit any minor fixups.**

If steps 1-5 surfaced anything, fix and:

```bash
git add -A && git commit -m "fix(workspace): resolve fallout from react-surface extraction"
```

---

## Phase 2 — Build pipeline (dual ESM+CJS + dts emission)

CI stays green throughout. Each package switches to dual format independently.

### Task 6: Update `@pretable/core` to dual ESM+CJS + dts

**Files:**

- Modify: `packages/core/tsup.config.ts`
- Modify: `packages/core/package.json`
- Delete: `packages/core/tsconfig.build.json` (no longer needed; tsup handles dts)

- [ ] **Step 1: Update `packages/core/tsup.config.ts`.**

Replace the entire file with:

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs",
  }),
  noExternal: ["@pretable-internal/grid-core"],
  treeshake: true,
});
```

- [ ] **Step 2: Move `@pretable-internal/grid-core` from `dependencies` to `devDependencies` in `packages/core/package.json`.**

The current `dependencies` block has only `@pretable-internal/grid-core`; remove the block entirely and add a fresh `devDependencies`:

```jsonc
{
  "devDependencies": {
    "@pretable-internal/grid-core": "workspace:*",
  },
}
```

After the edit, run `pnpm install` (already covered in Step 6 below) and confirm `pnpm list -r --filter @pretable/core` no longer lists grid-core under "dependencies" but under "devDependencies".

- [ ] **Step 3: Update `packages/core/package.json` `exports` and entry-point fields.**

```jsonc
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs",
    },
    "./package.json": "./package.json",
  },
  "sideEffects": false,
  "files": ["dist"],
}
```

- [ ] **Step 4: Update `packages/core/package.json` `build` script.**

```jsonc
{
  "scripts": {
    "build": "pnpm --filter @pretable-internal/grid-core build && tsup",
    // tsc -p tsconfig.build.json removed — tsup's dts:true handles types
  },
}
```

- [ ] **Step 5: Delete the now-redundant tsconfig.**

```bash
git rm packages/core/tsconfig.build.json
```

- [ ] **Step 6: Re-run pnpm install.**

```bash
pnpm install
```

- [ ] **Step 7: Build `@pretable/core`.**

```bash
pnpm --filter @pretable/core build
```

Expected:

```
packages/core/dist/index.mjs
packages/core/dist/index.cjs
packages/core/dist/index.d.ts
packages/core/dist/index.d.cts
```

(tsup emits both `.d.ts` and `.d.cts` when `dts: true` + dual format.)

- [ ] **Step 8: Verify the bundle inlines grid-core.**

```bash
grep '@pretable-internal' packages/core/dist/index.mjs | head
grep '@pretable-internal' packages/core/dist/index.cjs | head
```

Expected: zero matches in both.

- [ ] **Step 9: Run tests.**

```bash
pnpm --filter @pretable/core test
```

Expected: pass.

- [ ] **Step 10: Commit.**

```bash
git add packages/core/
git commit -m "build(core): dual ESM+CJS + dts emission via tsup"
```

### Task 7: Update `@pretable/react` to dual ESM+CJS + dts

**Files:**

- Modify: `packages/react/tsup.config.ts`
- Modify: `packages/react/package.json`
- Delete: `packages/react/tsconfig.build.json` (if it exists)

- [ ] **Step 1: Update `packages/react/tsup.config.ts` to final shape.**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["react", "react-dom", "@pretable/core"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs",
  }),
  noExternal: [/^@pretable-internal\//],
  treeshake: true,
});
```

- [ ] **Step 2: Update `packages/react/package.json` entry-point fields and exports.**

```jsonc
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs",
    },
    "./package.json": "./package.json",
  },
  "sideEffects": false,
  "files": ["dist"],
}
```

- [ ] **Step 3: Update `packages/react/package.json` `build` script.**

```jsonc
{
  "scripts": {
    "build": "pnpm --filter @pretable-internal/react-surface build && pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsup",
  },
}
```

- [ ] **Step 4: Delete legacy tsconfig if present.**

```bash
test -f packages/react/tsconfig.build.json && git rm packages/react/tsconfig.build.json || echo "already absent"
```

- [ ] **Step 5: Build.**

```bash
pnpm --filter @pretable/react build
```

Expected:

```
packages/react/dist/index.mjs
packages/react/dist/index.cjs
packages/react/dist/index.d.ts
packages/react/dist/index.d.cts
```

- [ ] **Step 6: Verify all internals inlined.**

```bash
grep '@pretable-internal' packages/react/dist/index.mjs | head
grep '@pretable-internal' packages/react/dist/index.cjs | head
```

Expected: zero matches.

- [ ] **Step 7: Verify externals are preserved.**

```bash
grep '@pretable/core\|"react"' packages/react/dist/index.mjs | head
```

Expected: imports from `@pretable/core` and `react` appear (they're external).

- [ ] **Step 8: Run tests.**

```bash
pnpm --filter @pretable/react test
```

Expected: pass.

- [ ] **Step 9: Commit.**

```bash
git add packages/react/
git commit -m "build(react): dual ESM+CJS + dts emission via tsup"
```

### Task 8: Update `@cacheplane/json-stream` to dual ESM+CJS + dts

**Files:**

- Modify: `packages/json-stream/tsup.config.ts`
- Modify: `packages/json-stream/package.json`
- Delete: `packages/json-stream/tsconfig.build.json` (if exists)

- [ ] **Step 1: Update `packages/json-stream/tsup.config.ts`.**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  outExtension: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".mjs",
  }),
  treeshake: true,
});
```

- [ ] **Step 2: Update `packages/json-stream/package.json`.**

Match the exports/main/module/types shape from Task 6 step 3 / Task 7 step 2. `peerDependencies` stays empty (json-stream has no deps).

- [ ] **Step 3: Update `build` script.**

```jsonc
{
  "scripts": {
    "build": "tsup",
  },
}
```

- [ ] **Step 4: Delete legacy tsconfig if present.**

```bash
test -f packages/json-stream/tsconfig.build.json && git rm packages/json-stream/tsconfig.build.json || echo "already absent"
```

- [ ] **Step 5: Build, verify, commit.**

```bash
pnpm --filter @cacheplane/json-stream build
ls packages/json-stream/dist/
pnpm --filter @cacheplane/json-stream test
git add packages/json-stream/
git commit -m "build(json-stream): dual ESM+CJS + dts emission via tsup"
```

### Task 9: Phase 2 verification

- [ ] **Step 1: Full workspace build.**

```bash
pnpm build
```

Expected: every package emits dual outputs (where applicable).

- [ ] **Step 2: Verify dist artifacts for each public package.**

```bash
for pkg in core react json-stream; do
  echo "=== $pkg ==="
  ls packages/$pkg/dist/
done
```

Expected: each shows `index.mjs`, `index.cjs`, `index.d.ts`, `index.d.cts`.

- [ ] **Step 3: Full workspace tests.**

```bash
pnpm test
```

- [ ] **Step 4: Full workspace typecheck.**

```bash
pnpm typecheck
```

- [ ] **Step 5: Format.**

```bash
pnpm format
```

If any format warnings, run `pnpm format:write` and commit.

---

## Phase 3 — Verification (publint + attw)

### Task 10: Add `publint` and `@arethetypeswrong/cli` to root devDependencies

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Add devDependencies.**

```bash
pnpm add -wD publint @arethetypeswrong/cli
```

`-w` installs at workspace root. Versions will pin to whatever's current on npm; verify at least:

- `publint`: ^0.3.x
- `@arethetypeswrong/cli`: ^0.18.x

- [ ] **Step 2: Verify install.**

```bash
pnpm exec publint --help
pnpm exec attw --help
```

Both should print help text.

- [ ] **Step 3: Commit.**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add publint and @arethetypeswrong/cli"
```

### Task 11: Add `lint:packaging` script to public packages

**Files:**

- Modify: `packages/core/package.json`
- Modify: `packages/react/package.json`
- Modify: `packages/json-stream/package.json`

- [ ] **Step 1: Add the script to each public package's `scripts`.**

```jsonc
{
  "scripts": {
    "lint:packaging": "publint --strict && attw --pack",
  },
}
```

- [ ] **Step 2: Run packaging lint locally on each package.**

```bash
pnpm --filter @pretable/core build && pnpm --filter @pretable/core lint:packaging
```

Expected: both `publint` and `attw` pass with no errors. If either fails, fix the package's `exports`/`files`/dist before continuing.

Repeat for `@pretable/react` and `@cacheplane/json-stream`. **Each must pass before the next phase.**

Common failures:

- `publint` complains about missing `./package.json` export → already added in Phase 2 tasks.
- `attw` complains about CJS↔ESM resolution → typically means `outExtension` is wrong or `exports` doesn't have both `import` and `require` conditions. Re-check Task 6/7/8 step 3.

- [ ] **Step 3: Commit.**

```bash
git add packages/{core,react,json-stream}/package.json
git commit -m "build(packaging): add publint+attw lint:packaging scripts"
```

### Task 12: Add `packaging` job to ci.yml

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the new job.**

In `.github/workflows/ci.yml`, add a `packaging` job after `build`:

```yaml
packaging:
  name: Packaging — publint + attw
  runs-on: ubuntu-latest
  needs: [build]
  steps:
    - uses: actions/checkout@v6
    - uses: pnpm/action-setup@v5
    - uses: actions/setup-node@v6
      with:
        node-version: 22
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@cacheplane/json-stream' build
    - run: pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@cacheplane/json-stream' lint:packaging
```

- [ ] **Step 2: Add `packaging` to `deploy-prod` and `deploy-preview` `needs:` arrays.**

Find the existing `deploy-prod:` and `deploy-preview:` jobs and add `packaging` to their `needs:` lists.

```yaml
  deploy-prod:
    needs: [test, typecheck, lint, format, build, packaging]
  ...
  deploy-preview:
    needs: [test, typecheck, lint, format, build, packaging]
```

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add packaging job (publint + attw) gating deploys"
```

---

## Phase 4 — Release pipeline

### Task 13: Update `.changeset/config.json`

**Files:**

- Modify: `.changeset/config.json`

- [ ] **Step 1: Replace the file contents.**

```jsonc
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "baseBranch": "main",
  "changelog": [
    "@svitejs/changesets-changelog-github-compact",
    { "repo": "cacheplane/pretable" },
  ],
  "access": "public",
  "commit": false,
  "fixed": [["@pretable/core", "@pretable/react", "@cacheplane/json-stream"]],
  "linked": [],
  "ignore": [],
  "updateInternalDependencies": "patch",
}
```

- [ ] **Step 2: Add the changelog generator dep.**

```bash
pnpm add -wD @svitejs/changesets-changelog-github-compact
```

- [ ] **Step 3: Verify changesets can read the config.**

```bash
pnpm exec changeset status --output=/tmp/changeset-status.json
cat /tmp/changeset-status.json
```

Expected: a JSON object listing `releases: []` (no pending changesets yet) and `changesets: []`.

- [ ] **Step 4: Commit.**

```bash
git add .changeset/config.json package.json pnpm-lock.yaml
git commit -m "chore(changesets): fixed group + github-compact changelog"
```

### Task 14: Add `.changeset/initial-release.md` (the seed for 0.0.1)

**Files:**

- Create: `.changeset/initial-release.md`

- [ ] **Step 1: Write the changeset.**

```bash
cat > .changeset/initial-release.md <<'EOF'
---
"@pretable/core": patch
"@pretable/react": patch
"@cacheplane/json-stream": patch
---

Initial release. Pretable's wrapped-text scroll wedge (4× faster than Grid Alpha on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs Grid Alpha's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives.

See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.
EOF
```

- [ ] **Step 2: Verify the changeset is recognized.**

```bash
pnpm exec changeset status
```

Expected output: shows the three packages as receiving a `patch` bump, target version `0.0.1`.

- [ ] **Step 3: Dry-run the version step locally.**

```bash
pnpm exec changeset version
```

This will:

1. Update `packages/{core,react,json-stream}/package.json` versions to `0.0.1`
2. Generate `packages/{core,react,json-stream}/CHANGELOG.md` files
3. Delete `.changeset/initial-release.md` (consumed by the action)

After verifying the diff looks right, **revert the changes** because we want the action to do this on merge:

```bash
git checkout .changeset/ packages/{core,react,json-stream}/package.json
rm -f packages/{core,react,json-stream}/CHANGELOG.md
```

- [ ] **Step 4: Verify state matches step 1.**

```bash
ls .changeset/
```

Expected: `config.json`, `initial-release.md`, `README.md`.

- [ ] **Step 5: Commit.**

```bash
git add .changeset/initial-release.md
git commit -m "chore(changesets): seed initial 0.0.1 release"
```

### Task 15: Create `.github/workflows/release.yml`

**Files:**

- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow.**

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    name: Release — version PR or publish
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    env:
      NPM_CONFIG_PROVENANCE: true
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          registry-url: https://registry.npmjs.org

      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@cacheplane/json-stream' lint:packaging

      - name: Version PR or publish
        id: changesets
        uses: changesets/action@v1
        with:
          version: pnpm exec changeset version
          publish: pnpm exec changeset publish
          title: "chore: version packages"
          commit: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Enable auto-merge on Version PR
        if: steps.changesets.outputs.pullRequestNumber != ''
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr merge \
            --auto \
            --squash \
            --repo ${{ github.repository }} \
            ${{ steps.changesets.outputs.pullRequestNumber }}
```

- [ ] **Step 2: Validate YAML syntax.**

```bash
python3 -c 'import yaml; yaml.safe_load(open(".github/workflows/release.yml"))' && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release.yml — changesets/action with provenance + auto-merge"
```

---

## Phase 5 — Final verification + PR

### Task 16: Pre-PR verification

- [ ] **Step 1: Confirm `NPM_TOKEN` repo secret exists (manual; outside the PR diff).**

```bash
gh secret list --repo cacheplane/pretable | grep NPM_TOKEN
```

Expected: `NPM_TOKEN` appears in the listing. If missing, generate a token at `https://npmjs.com/settings/<user>/tokens` (type: **Automation**, scope: read+write for `@pretable/*` and `@cacheplane/*`) and `gh secret set NPM_TOKEN --repo cacheplane/pretable`.

- [ ] **Step 2: Confirm npm scope ownership / availability.**

```bash
npm owner ls @pretable/core 2>/dev/null
npm owner ls @cacheplane/json-stream 2>/dev/null
```

Expected: 404 (packages don't exist yet — registry rejects ownership query). If either returns a different owner, scope claim is needed before merge.

- [ ] **Step 3: Confirm branch protection on `main`.**

In GitHub repo settings → Branches → `main`, "Require status checks to pass before merging" should include: `test`, `typecheck`, `lint`, `format`, `build`, `packaging`. The `packaging` check is new in this PR; once merged, auto-merge of the Version Packages PR will fail unless this required-check list is updated.

Don't block on this for the PR open (the runbook covers it). Note in the PR description.

- [ ] **Step 4: Run the full verification suite locally.**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm build
pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@cacheplane/json-stream' lint:packaging
```

All must pass. Fix anything that doesn't, commit, repeat.

- [ ] **Step 5: Smoke a published-style install locally with `npm pack`.**

```bash
mkdir -p /tmp/pretable-pack-smoke && cd /tmp/pretable-pack-smoke
for pkg in core react json-stream; do
  pnpm --filter @pretable/$pkg pack --pack-destination /tmp/pretable-pack-smoke 2>/dev/null || \
    pnpm --filter @cacheplane/$pkg pack --pack-destination /tmp/pretable-pack-smoke
done
ls /tmp/pretable-pack-smoke/
```

Expected: three `.tgz` files. Inspect each tarball:

```bash
for f in /tmp/pretable-pack-smoke/*.tgz; do
  echo "=== $f ==="
  tar tzf "$f" | sort
  echo
done
```

For each tarball, expected files:

- `package/package.json`
- `package/README.md` (if exists in source)
- `package/dist/index.mjs`
- `package/dist/index.cjs`
- `package/dist/index.d.ts`
- `package/dist/index.d.cts`

Check that NONE of the tarballs contain:

- `package/dist/internal.*`
- `package/src/`
- `package/__tests__/`

If any tarball has unexpected content, the `files` field or `tsup` entry is wrong; fix before opening the PR.

```bash
cd - >/dev/null
```

### Task 17: Open PR

- [ ] **Step 1: Push the branch.**

The branch was created at the start of execution (before Task 1). Use the existing branch name:

```bash
git push -u origin "$(git branch --show-current)"
```

- [ ] **Step 2: Open the PR.**

```bash
gh pr create --title "feat(release): npm publishing pipeline (initial 0.0.1 release)" --body "$(cat <<'EOF'
## Summary

Establishes the npm publishing pipeline for `@pretable/core`, `@pretable/react`, and `@cacheplane/json-stream`. Ships them as version `0.0.1` via `changesets/action@v1` with provenance attestation. Aligns with GridBeta Query's verification pattern (`publint --strict && attw --pack`) and Dawn's release.yml shape.

Spec: [docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md](docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md)
Plan: [docs/superpowers/plans/2026-05-01-npm-publishing-pipeline.md](docs/superpowers/plans/2026-05-01-npm-publishing-pipeline.md)

## What changes

- **New private package `@pretable-internal/react-surface`** holding the React surface seam (`PretableSurface`, `usePretableModel`, `LabeledGridSurface`, `InspectionGrid`, telemetry types). Bench, website, streaming-demo consume it directly. `@pretable/react` consumes it and bundles it into the published tarball via `tsup noExternal`.
- **Public packages switch to dual ESM+CJS** with `tsup`'s `dts: true` for bundled type emission. Bundled internal deps moved to `devDependencies` so the published manifest doesn't reference unpublishable workspace versions.
- **`packaging` CI job** runs `publint --strict && attw --pack` per public package; `deploy-prod` and `deploy-preview` gain it as a `needs:` gate.
- **Changesets configured as a fixed group** locking the three public packages to the same version. Changelog generator switched to `@svitejs/changesets-changelog-github-compact`.
- **`.changeset/initial-release.md`** seeds the first 0.0.1 release.
- **`.github/workflows/release.yml`** — `changesets/action@v1` with `id-token: write` + `NPM_CONFIG_PROVENANCE: true`. Auto-merges the Version Packages PR via `gh pr merge --auto`.

## Pre-merge checklist (manual; runbook reference)

- [ ] `gh secret list` shows `NPM_TOKEN` (Automation token with read+write on `@pretable` and `@cacheplane`)
- [ ] `npm owner ls @pretable/core` returns 404 (scope free / claimable)
- [ ] Branch protection on `main` updated to require the new `packaging` check

## Post-merge runbook

1. Watch `release.yml` open the "chore: version packages" PR, auto-merge it, then publish 0.0.1 with provenance.
2. Verify on npmjs.com: each package shows the "Built and signed on GitHub Actions" badge.
3. Configure trusted publishing per package (Add Trusted Publisher → cacheplane/pretable / release.yml).
4. Follow up with a small PR to drop `NPM_TOKEN` from the workflow once trusted publishing is verified on the next release.

## Test plan

- [ ] CI green (test/typecheck/lint/format/build/packaging).
- [ ] Preview deploy renders correctly.
- [ ] After merge: `release.yml` opens Version PR, auto-merges, publishes 0.0.1 with provenance.
- [ ] `npm install @pretable/core@0.0.1 @pretable/react@0.0.1 @cacheplane/json-stream@0.0.1 react@^19` in a fresh dir succeeds; `node -e "console.log(Object.keys(require('@pretable/core')))"` works.
EOF
)"
```

- [ ] **Step 3: Watch CI.**

Capture the PR number from the previous step's output (it's the last line). Then:

```bash
PR=$(gh pr view --json number --jq .number)
gh pr checks "$PR" --watch
```

Expected: all checks (test, typecheck, lint, format, build, packaging, deploy-preview) pass.

- [ ] **Step 4: Merge once green.**

```bash
gh pr merge "$PR" --squash --delete-branch
```

This triggers `release.yml` on `main`. The first run sees the unmerged `.changeset/initial-release.md` and opens the Version Packages PR. CI on that PR runs; auto-merge fires when green; merging triggers `release.yml` again; `changeset publish` runs with provenance and ships 0.0.1 to npm.

---

## Done

After Task 17 step 4, complete the post-merge runbook in the spec (verify install, configure trusted publishing, drop NPM_TOKEN in a follow-up PR).
