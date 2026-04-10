# Pretable Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a modern `pnpm` monorepo for Pretable with two publishable packages, internal workspace packages, benchmark and playground apps, and working build/test/typecheck/release plumbing.

**Architecture:** Use a plain `pnpm` workspace with TypeScript project references, `tsup` for library builds, Vite React apps for `bench` and `playground`, and Changesets for release management. Keep `@pretable/core` and `@pretable/react` publishable while all engine and benchmark support packages remain private and consumable only inside the workspace.

**Tech Stack:** `pnpm`, TypeScript, React, Vite, Vitest, Playwright, ESLint, Changesets, `tsup`

---

## File Structure Map

## Execution Context

This plan assumes the repository has already been initialized with `git init` during the brainstorming/spec phase in the current workspace at `/Users/blove/repos/pretable`. Do not re-run `git init` unless the `.git` directory is missing.

### Root files

- Create: `/Users/blove/repos/pretable/package.json`
- Create: `/Users/blove/repos/pretable/pnpm-workspace.yaml`
- Create: `/Users/blove/repos/pretable/tsconfig.base.json`
- Create: `/Users/blove/repos/pretable/tsconfig.json`
- Create: `/Users/blove/repos/pretable/eslint.config.js`
- Create: `/Users/blove/repos/pretable/.gitignore`
- Create: `/Users/blove/repos/pretable/.npmrc`
- Create: `/Users/blove/repos/pretable/playwright.config.ts`
- Create: `/Users/blove/repos/pretable/vitest.workspace.ts`
- Create: `/Users/blove/repos/pretable/README.md`
- Create: `/Users/blove/repos/pretable/.changeset/README.md`
- Create: `/Users/blove/repos/pretable/.changeset/config.json`

### Public packages

- Create: `/Users/blove/repos/pretable/packages/core/package.json`
- Create: `/Users/blove/repos/pretable/packages/core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/core/tsup.config.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/create-grid.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/types.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/__tests__/create-grid.test.ts`
- Create: `/Users/blove/repos/pretable/packages/react/package.json`
- Create: `/Users/blove/repos/pretable/packages/react/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/react/tsup.config.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/pretable.tsx`
- Create: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/__tests__/pretable.test.tsx`

### Internal packages

- Create: `/Users/blove/repos/pretable/packages/text-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/text-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/text-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/layout-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/layout-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/layout-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/grid-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/grid-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/grid-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/package.json`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/package.json`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/package.json`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`

### Apps

- Create: `/Users/blove/repos/pretable/apps/bench/package.json`
- Create: `/Users/blove/repos/pretable/apps/bench/tsconfig.json`
- Create: `/Users/blove/repos/pretable/apps/bench/vite.config.ts`
- Create: `/Users/blove/repos/pretable/apps/bench/index.html`
- Create: `/Users/blove/repos/pretable/apps/bench/src/main.tsx`
- Create: `/Users/blove/repos/pretable/apps/bench/src/app.tsx`
- Create: `/Users/blove/repos/pretable/apps/bench/src/app.css`
- Create: `/Users/blove/repos/pretable/apps/playground/package.json`
- Create: `/Users/blove/repos/pretable/apps/playground/tsconfig.json`
- Create: `/Users/blove/repos/pretable/apps/playground/vite.config.ts`
- Create: `/Users/blove/repos/pretable/apps/playground/index.html`
- Create: `/Users/blove/repos/pretable/apps/playground/src/main.tsx`
- Create: `/Users/blove/repos/pretable/apps/playground/src/app.tsx`
- Create: `/Users/blove/repos/pretable/apps/playground/src/app.css`

### Existing docs and output directories

- Preserve: `/Users/blove/repos/pretable/docs/superpowers/specs/2026-04-10-pretable-monorepo-design.md`
- Ensure directories exist: `/Users/blove/repos/pretable/docs/spec`, `/Users/blove/repos/pretable/docs/research`, `/Users/blove/repos/pretable/status/traces`, `/Users/blove/repos/pretable/status/snapshots`

## Task 1: Bootstrap the root workspace

**Files:**

- Create: `/Users/blove/repos/pretable/package.json`
- Create: `/Users/blove/repos/pretable/pnpm-workspace.yaml`
- Create: `/Users/blove/repos/pretable/.gitignore`
- Create: `/Users/blove/repos/pretable/.npmrc`
- Create: `/Users/blove/repos/pretable/README.md`

- [ ] **Step 1: Write the root workspace manifest**

```json
{
  "name": "pretable",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r --filter './packages/*' build && pnpm -r --filter './apps/*' build",
    "dev:bench": "pnpm --filter @pretable/app-bench dev",
    "dev:playground": "pnpm --filter @pretable/app-playground dev",
    "format": "prettier --check .",
    "format:write": "prettier --write .",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@changesets/cli": "^2.29.0",
    "@eslint/js": "^9.24.0",
    "@playwright/test": "^1.53.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.15.2",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "eslint": "^9.24.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.19",
    "globals": "^16.0.0",
    "jsdom": "^26.1.0",
    "prettier": "^3.5.3",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "tsup": "^8.5.0",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.30.1",
    "vite": "^6.3.2",
    "vitest": "^3.1.1"
  }
}
```

- [ ] **Step 2: Add workspace discovery and install behavior**

Write `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Write `.npmrc`:

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 3: Add ignore rules and root readme**

Write `.gitignore` with `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, `.turbo`, `.DS_Store`, `status/changeset-status.json`, and generated tarballs under `status/snapshots/` so release smoke outputs stay untracked.

Write `README.md` with:

- workspace purpose
- package layout summary
- bootstrap command `pnpm install`
- main verification commands

- [ ] **Step 4: Run install to generate the lockfile**

Run: `pnpm install`
Expected: lockfile generated successfully with no missing workspace manifest errors.

- [ ] **Step 5: Commit the root bootstrap**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .gitignore README.md
git commit -m "chore: bootstrap pnpm workspace"
```

## Task 2: Add shared TypeScript, lint, test, and release tooling

**Files:**

- Create: `/Users/blove/repos/pretable/tsconfig.base.json`
- Create: `/Users/blove/repos/pretable/tsconfig.json`
- Create: `/Users/blove/repos/pretable/eslint.config.js`
- Create: `/Users/blove/repos/pretable/playwright.config.ts`
- Create: `/Users/blove/repos/pretable/vitest.workspace.ts`
- Create: `/Users/blove/repos/pretable/.changeset/README.md`
- Create: `/Users/blove/repos/pretable/.changeset/config.json`

- [ ] **Step 1: Write shared TypeScript config**

Write `tsconfig.base.json` with strict compiler settings, `moduleResolution: "Bundler"`, declaration output support, React JSX support, and shared path aliases:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "declaration": true,
    "composite": true,
    "skipLibCheck": true,
    "baseUrl": "."
  }
}
```

Write `tsconfig.json` as an initial solution-style root with no project references yet:

```json
{
  "files": []
}
```

Add project references later in Task 6 after all packages and apps exist.

- [ ] **Step 2: Add ESLint and Vitest workspace config**

Write `eslint.config.js` using modern flat config with TypeScript and React support.

Write `vitest.workspace.ts` to include package and app test projects, and make the React-facing test environment explicit:

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core",
  "packages/react",
  "apps/bench",
  "apps/playground",
]);
```

Add a Prettier-compatible formatting setup by:

- relying on the root `format` and `format:write` scripts added in Task 1
- keeping ESLint focused on correctness rather than formatting rules

- [ ] **Step 3: Add Playwright and Changesets setup**

Write `playwright.config.ts` for a Chromium-first local setup with `apps/bench` as the eventual benchmark target.

Write `.changeset/config.json` so only `@pretable/core` and `@pretable/react` are intended for release while private packages remain unpublished by package metadata.

- [ ] **Step 4: Run static verification for root tooling**

Run: `pnpm exec tsc -b --dry`
Expected: configuration parses without root solution errors.

Run: `pnpm exec eslint eslint.config.js`
Expected: ESLint config loads without module errors.

Run: `pnpm format`
Expected: formatting check runs and only reports files that need formatting, not missing-command errors.

- [ ] **Step 5: Commit the shared tooling**

```bash
git add tsconfig.base.json tsconfig.json eslint.config.js playwright.config.ts vitest.workspace.ts .changeset
git commit -m "chore: add shared monorepo tooling"
```

## Task 3: Scaffold the public packages

**Files:**

- Create: `/Users/blove/repos/pretable/packages/core/package.json`
- Create: `/Users/blove/repos/pretable/packages/core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/core/tsup.config.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/create-grid.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/types.ts`
- Create: `/Users/blove/repos/pretable/packages/core/src/__tests__/create-grid.test.ts`
- Create: `/Users/blove/repos/pretable/packages/react/package.json`
- Create: `/Users/blove/repos/pretable/packages/react/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/react/tsup.config.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/pretable.tsx`
- Create: `/Users/blove/repos/pretable/packages/react/src/use-pretable.ts`
- Create: `/Users/blove/repos/pretable/packages/react/src/__tests__/pretable.test.tsx`

- [ ] **Step 1: Write the failing tests for the public API placeholders**

`packages/core/src/__tests__/create-grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGrid } from "../create-grid";

describe("createGrid", () => {
  it("returns a typed placeholder instance", () => {
    const grid = createGrid({ columns: [], rows: [] });
    expect(grid.kind).toBe("pretable-grid");
  });
});
```

`packages/react/src/__tests__/pretable.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pretable } from "../pretable";

it("renders a placeholder label", () => {
  render(<Pretable rows={[]} columns={[]} />);
  expect(screen.getByText("Pretable React adapter")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

First create minimal package manifests, `tsconfig.json`, and `tsup.config.ts` files for both public packages with scripts and dependency declarations, but do not create source files yet.

`packages/core/package.json` must include:

- `name: "@pretable/core"`
- `version: "0.0.0"`
- `type: "module"`
- `files: ["dist"]`
- `main`, `module`, `types`, and `exports` pointing at `dist`
- scripts:
  - `build: tsup`
  - `lint: eslint src --ext .ts`
  - `test: vitest run`
  - `typecheck: tsc -p tsconfig.json --noEmit`

`packages/core/tsconfig.json` must:

- extend `../../tsconfig.base.json`
- set `rootDir: "src"` and `outDir: "dist"`
- enable declaration emit
- include `src`
- exclude `src/**/*.test.*` and `src/**/__tests__/**` so package build/typecheck only covers publishable source files

`packages/core/tsup.config.ts` must build `src/index.ts` to ESM with declarations and cleaned output.

`packages/react/package.json` must include:

- `name: "@pretable/react"`
- `version: "0.0.0"`
- `type: "module"`
- `files: ["dist"]`
- `peerDependencies: { "react": "^19.0.0", "react-dom": "^19.0.0" }`
- `dependencies: { "@pretable/core": "workspace:*" }`
- scripts:
  - `build: tsup`
  - `lint: eslint src --ext .ts,.tsx`
  - `test: vitest run --environment jsdom`
  - `typecheck: tsc -p tsconfig.json --noEmit`

`packages/react/tsconfig.json` must extend the root base config and reference `../core`, and exclude `src/**/*.test.*` and `src/**/__tests__/**` so build/typecheck does not require Vitest-specific typings.

`packages/react/tsup.config.ts` must build `src/index.ts` to ESM with declarations and mark `react`, `react-dom`, and `@pretable/core` as external.

Run: `pnpm install`
Expected: workspace dependencies and scripts resolve successfully, with root-installed `react` and `react-dom` available for local package verification.

Run: `pnpm --filter @pretable/core test`
Expected: FAIL because test imports source files that still do not exist.

Run: `pnpm --filter @pretable/react test`
Expected: FAIL because test imports source files that still do not exist.

- [ ] **Step 3: Implement the minimal public package skeleton**

Write `packages/core/src/create-grid.ts` with:

```ts
import type { PretableGrid, PretableGridOptions } from "./types";

export function createGrid(options: PretableGridOptions): PretableGrid {
  return {
    kind: "pretable-grid",
    options,
  };
}
```

Write `packages/core/src/types.ts` with minimal `PretableColumn`, `PretableRow`, `PretableGridOptions`, and `PretableGrid` types.

Write `packages/core/src/index.ts` exporting `createGrid` and the public types.

Write `packages/react/src/pretable.tsx` with a minimal component that creates the placeholder grid and renders a label plus row and column counts.

Write `packages/react/src/use-pretable.ts` with a small hook that memoizes `createGrid({ rows, columns })`.

Write `packages/react/src/index.ts` exporting the component, hook, and public types re-exported from `@pretable/core`.

- [ ] **Step 4: Run package-local verification**

Run: `pnpm --filter @pretable/core test`
Expected: PASS

Run: `pnpm --filter @pretable/react test`
Expected: PASS

Run: `pnpm --filter @pretable/core build`
Expected: `dist` output generated

Run: `pnpm --filter @pretable/react build`
Expected: `dist` output generated

Run: `pnpm --filter @pretable/core typecheck`
Expected: PASS

Run: `pnpm --filter @pretable/react typecheck`
Expected: PASS

- [ ] **Step 5: Commit the public package scaffold**

```bash
git add packages/core packages/react
git commit -m "feat: scaffold public packages"
```

## Task 4: Scaffold the internal packages

**Files:**

- Create: `/Users/blove/repos/pretable/packages/text-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/text-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/text-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/layout-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/layout-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/layout-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/grid-core/package.json`
- Create: `/Users/blove/repos/pretable/packages/grid-core/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/grid-core/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/package.json`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/renderer-dom/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/package.json`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/scenario-data/src/index.ts`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/package.json`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/tsconfig.json`
- Create: `/Users/blove/repos/pretable/packages/bench-runner/src/index.ts`

- [ ] **Step 1: Write a failing typecheck target for internal package exports**

First create internal package manifests and `tsconfig.json` files with scripts and compiler options, but do not create any `src/index.ts` files yet.

Run: `pnpm install`
Expected: workspace metadata updates successfully.

Run: `pnpm --filter @pretable-internal/grid-core typecheck`
Expected: FAIL because the package points at source files that do not exist yet.

- [ ] **Step 2: Implement minimal private package manifests**

Each internal `package.json` should include:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -b"
  }
}
```

Use names:

- `@pretable-internal/text-core`
- `@pretable-internal/layout-core`
- `@pretable-internal/grid-core`
- `@pretable-internal/renderer-dom`
- `@pretable-internal/scenario-data`
- `@pretable-internal/bench-runner`

Add matching workspace dependencies where package relationships exist:

- `@pretable-internal/grid-core` depends on `@pretable-internal/text-core` and `@pretable-internal/layout-core`
- `@pretable-internal/renderer-dom` depends on `@pretable-internal/grid-core`
- `@pretable-internal/bench-runner` depends on `@pretable-internal/scenario-data`

Each internal `tsconfig.json` must:

- extend `../../tsconfig.base.json`
- set `rootDir: "src"` and `outDir: "dist"`
- include `src`

Add package references where appropriate:

- `grid-core` references `text-core` and `layout-core`
- `renderer-dom` references `grid-core`
- `bench-runner` references `scenario-data`

- [ ] **Step 3: Add minimal source exports**

Use a single stable export per package so dependents can compile immediately.

Example for `packages/bench-runner/src/index.ts`:

```ts
export type BenchAdapterProfile = "default" | "tuned";

export interface BenchAdapter {
  id: string;
}
```

Follow the same pattern for the other internal packages with a small placeholder type or constant tied to the package purpose.

Example `packages/text-core/src/index.ts`:

```ts
export interface PreparedTextRecord {
  text: string;
  fontKey: string;
}
```

After writing all internal manifests and sources, run: `pnpm install`
Expected: lockfile updates to include any newly referenced workspace packages.

- [ ] **Step 4: Run internal package verification**

Run: `pnpm -r --filter '@pretable-internal/*' typecheck`
Expected: PASS

Run: `pnpm -r --filter '@pretable-internal/*' build`
Expected: PASS

- [ ] **Step 5: Commit the internal package scaffold**

```bash
git add packages/text-core packages/layout-core packages/grid-core packages/renderer-dom packages/scenario-data packages/bench-runner tsconfig.json
git commit -m "feat: scaffold internal packages"
```

## Task 5: Scaffold the bench and playground apps

**Files:**

- Create: `/Users/blove/repos/pretable/apps/bench/package.json`
- Create: `/Users/blove/repos/pretable/apps/bench/tsconfig.json`
- Create: `/Users/blove/repos/pretable/apps/bench/vite.config.ts`
- Create: `/Users/blove/repos/pretable/apps/bench/index.html`
- Create: `/Users/blove/repos/pretable/apps/bench/src/main.tsx`
- Create: `/Users/blove/repos/pretable/apps/bench/src/app.tsx`
- Create: `/Users/blove/repos/pretable/apps/bench/src/app.css`
- Create: `/Users/blove/repos/pretable/apps/playground/package.json`
- Create: `/Users/blove/repos/pretable/apps/playground/tsconfig.json`
- Create: `/Users/blove/repos/pretable/apps/playground/vite.config.ts`
- Create: `/Users/blove/repos/pretable/apps/playground/index.html`
- Create: `/Users/blove/repos/pretable/apps/playground/src/main.tsx`
- Create: `/Users/blove/repos/pretable/apps/playground/src/app.tsx`
- Create: `/Users/blove/repos/pretable/apps/playground/src/app.css`

- [ ] **Step 1: Write the failing app build target**

Create app manifests and local `tsconfig.json` files for both apps, but do not update the root `tsconfig.json` references until Task 6.

Run: `pnpm --filter @pretable/app-bench build`
Expected: FAIL because the app files do not exist yet.

- [ ] **Step 2: Implement the bench app**

Write a Vite React app named `@pretable/app-bench`.

`apps/bench/package.json` must include:

- `name: "@pretable/app-bench"`
- `private: true`
- scripts:
  - `dev: vite`
  - `build: vite build`
  - `lint: eslint src --ext .ts,.tsx`
  - `test: vitest run --environment jsdom --passWithNoTests`
  - `typecheck: tsc -p tsconfig.json --noEmit`
- dependencies on `react`, `react-dom`, and `@pretable/react`

`apps/bench/tsconfig.json` must extend `../../tsconfig.base.json` and reference `../../packages/react`.

`apps/bench/vite.config.ts` must use `@vitejs/plugin-react`.

`apps/bench/index.html` must provide a `div#root` mount point.

`apps/bench/src/main.tsx` must render `<App />` using `ReactDOM.createRoot`.

`apps/bench/src/app.tsx` should:

- render a scenario list sourced from a local placeholder array
- import `Pretable` from `@pretable/react`
- explain that competitor routes and metrics wiring are pending

- [ ] **Step 3: Implement the playground app**

Write a Vite React app named `@pretable/app-playground`.

`apps/playground/package.json` must include:

- `name: "@pretable/app-playground"`
- `private: true`
- scripts:
  - `dev: vite`
  - `build: vite build`
  - `lint: eslint src --ext .ts,.tsx`
  - `test: vitest run --environment jsdom --passWithNoTests`
  - `typecheck: tsc -p tsconfig.json --noEmit`
- dependencies on `react`, `react-dom`, and `@pretable/react`

`apps/playground/tsconfig.json` must extend `../../tsconfig.base.json` and reference `../../packages/react`.

`apps/playground/vite.config.ts` must mirror the bench app.

`apps/playground/index.html` must provide a `div#root` mount point.

`apps/playground/src/main.tsx` must render `<App />`.

`apps/playground/src/app.tsx` should:

- render a manual debugging page
- import `Pretable` from `@pretable/react`
- render sample rows and columns

After writing both app manifests and configs, run: `pnpm install`
Expected: workspace linking updates and app build dependencies resolve.

- [ ] **Step 4: Run app verification**

Run: `pnpm --filter @pretable/app-bench build`
Expected: PASS

Run: `pnpm --filter @pretable/app-playground build`
Expected: PASS

Run: `pnpm --filter @pretable/app-bench typecheck`
Expected: PASS

Run: `pnpm --filter @pretable/app-playground typecheck`
Expected: PASS

- [ ] **Step 5: Commit the app scaffold**

```bash
git add apps/bench apps/playground
git commit -m "feat: scaffold bench and playground apps"
```

## Task 6: Final integration and release verification

**Files:**

- Modify: `/Users/blove/repos/pretable/package.json`
- Modify: `/Users/blove/repos/pretable/README.md`
- Ensure directories exist: `/Users/blove/repos/pretable/docs/spec`, `/Users/blove/repos/pretable/docs/research`, `/Users/blove/repos/pretable/status/traces`, `/Users/blove/repos/pretable/status/snapshots`

- [ ] **Step 1: Create the remaining docs and status directories**

Run: `mkdir -p docs/spec docs/research status/traces status/snapshots`
Expected: directories exist for later benchmark outputs and documentation.

Create tracked placeholder files:

- `/Users/blove/repos/pretable/docs/spec/.gitkeep`
- `/Users/blove/repos/pretable/docs/research/.gitkeep`
- `/Users/blove/repos/pretable/status/traces/.gitkeep`
- `/Users/blove/repos/pretable/status/snapshots/.gitkeep`

- [ ] **Step 2: Finalize root scripts if app or package names changed during implementation**

Ensure `package.json` scripts resolve these commands:

```bash
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

Update `tsconfig.json` to add references for all package and app projects now that they exist.

- [ ] **Step 3: Run full workspace verification**

Run: `pnpm lint`
Expected: PASS

Run: `pnpm test`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Smoke-test release metadata**

Run: `pnpm exec changeset --version > ./status/changeset-status.json`
Expected: command succeeds and writes the installed Changesets CLI version to `status/changeset-status.json`.

Run: `pnpm --filter @pretable/core pack --pack-destination ../../status/snapshots`
Expected: tarball generated for `@pretable/core`

Run: `pnpm --filter @pretable/react pack --pack-destination ../../status/snapshots`
Expected: tarball generated for `@pretable/react`

Run: `node -e "import('./packages/core/dist/index.js').then(m => console.log(typeof m.createGrid))"`
Expected: prints `function`

Run: `node -e "import('./packages/react/dist/index.js').then(m => console.log(typeof m.Pretable))"`
Expected: prints `function`

- [ ] **Step 5: Commit the verified scaffold**

```bash
git add package.json README.md tsconfig.json docs/spec docs/research status
git commit -m "chore: verify monorepo scaffold"
```
