# Security Modernization PR 3: Public Package Build Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tsup with a supported, explicit tsdown architecture; retain first-class ESM/CommonJS and older-resolver accommodation; support React 18 and 19 from packed artifacts; and reduce the repository to zero advisories with permanent merge, deploy, and release enforcement.

**Architecture:** One typed shared tsdown policy controls format, syntax, maps, declarations, cleaning, and manifest non-mutation, while four thin package configs declare their own bundle/external boundaries. Canonical UI CSS lives at package root. Permanent tests pack tarballs into clean fixtures and prove module, resolver, React, CSS, dependency, tree-shaking, and security contracts independently of workspace links.

**Tech Stack:** Node.js 24.19.0, pnpm 10.12.1, exact-pinned tsdown, TypeScript 6, API Extractor, npm tarballs, React 18/19, jsdom 30, Vite, current Webpack, Acorn (or an equivalently reviewed ES2018 parser), Vitest, Playwright, Changesets.

---

## File map

| Area | Files and responsibility |
| --- | --- |
| Build dependency and commands | `package.json`, `pnpm-lock.yaml`: remove tsup, exact-pin reviewed tsdown and any explicit consumer-test parser/bundler tooling, register permanent checks. |
| Shared policy | `scripts/build/tsdown-config.ts` (new): typed cross-package format/target/map/declaration/clean policy with no workspace orchestration. |
| Package boundaries | `packages/{core,react,stream-adapter,ui}/tsdown.config.ts` (new), delete corresponding `tsup.config.ts`; each package owns only itself. |
| Manifests | `packages/{core,react,stream-adapter,ui}/package.json`: verified exports/main/module/types, build script, side effects, files, peer/dependency boundaries. |
| Canonical CSS | Move `packages/ui/src/{grid,tokens,tailwind}.css` and `src/themes/*.css` to `packages/ui/` and `packages/ui/themes/`; add adjacent checked-in `.css.d.ts`; delete `packages/ui/scripts/copy-css-assets.mjs`. |
| CSS consumers/tests | `packages/ui/src/__tests__/{build-config,contract,css-cascade}.test.ts`, `packages/ui/README.md`, `apps/bench/tests/cascade-override.spec.ts`, `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`, `apps/bench/src/{bench-runtime.ts,__tests__/bench-runtime.test.ts}`, `packages/react/src/density.ts`, `apps/website/content/docs/theming/token-reference.mdx`, and current comments/docs that identify the active source path. |
| Build contract tests | Existing package `build-config.test.ts` files plus new root `scripts/__tests__/public-package-build-contract.test.mjs`: artifact grammar, maps, external boundaries, package ownership, manifest immutability. |
| Packed consumers | `scripts/check-packed-consumers.mjs`, `scripts/__tests__/check-packed-consumers.test.mjs`, and small committed fixture sources/configs under `test-fixtures/packed-consumers/`. |
| React matrix | `scripts/check-react-compatibility.mjs`, `scripts/__tests__/check-react-compatibility.test.mjs`, and representative fixture source/configs under `test-fixtures/react-compatibility/`. |
| Security | Delete PR 2 transition checker/test; add permanent `security:audit` script and update workflow contract tests, `.github/workflows/ci.yml`, `.github/workflows/release.yml`. |
| Compatibility docs | `README.md`, `packages/react/README.md`, `apps/website/content/docs/getting-started/index.mdx`, plus a focused package-compatibility section/file chosen from current docs navigation. |
| Release note | One new `.changeset/*.md` with `minor` entries for the fixed public group. |

Output filenames are not the contract. After the first tsdown build, set manifests to the reviewed actual filenames and lock them with packed-consumer tests. Do not preserve a filename by adding a compatibility copy unless a documented package-name/subpath contract requires it.

## Exact fixture map and execution contract

The implementer may adjust syntax to the selected exact tool versions, but may not invent a different coverage architecture without amending this reviewed plan. All paths below are committed source/config fixtures; generated manifests, tarballs, `node_modules`, build output, and npm caches live only beneath the harness's validated temporary root.

### Packed-consumer fixture files

| Path | Exact responsibility and command |
| --- | --- |
| `test-fixtures/packed-consumers/node/esm.mjs` | Import every public package by name, assert representative exports, and write sorted export names. Run with `node node/esm.mjs`. |
| `test-fixtures/packed-consumers/node/cjs.cjs` | Require every public package by name and write the same sorted export names. Run with `node node/cjs.cjs`; harness compares output deeply with ESM. |
| `test-fixtures/packed-consumers/types/public-api.tsx` | Use `Pretable`, representative core types/functions, UI helper, and stream adapter exclusively from public package names. |
| `test-fixtures/packed-consumers/types/tsconfig.nodenext.json` | `strict`, `skipLibCheck: false`, DOM+ES2018 libs, `module/moduleResolution: NodeNext`, `jsx: react-jsx`, `noEmit`. Run `npx tsc -p types/tsconfig.nodenext.json`. |
| `test-fixtures/packed-consumers/types/tsconfig.legacy.json` | Same source and strictness, `module: CommonJS`, `moduleResolution: Node10`, `target: ES2018`, `noEmit`. Run `npx tsc -p types/tsconfig.legacy.json`. |
| `test-fixtures/packed-consumers/vite/index.html` | Minimal module-script host for Vite. |
| `test-fixtures/packed-consumers/vite/entry.mjs` | Import a small React/core surface plus every documented UI CSS subpath; expose a deterministic value so bundling cannot erase the entry. |
| `test-fixtures/packed-consumers/vite/vite.config.mjs` | Production build to a fixture-local `dist`, sourcemap enabled, target `es2018`. Run `npx vite build --config vite/vite.config.mjs`. |
| `test-fixtures/packed-consumers/webpack/entry-esm.mjs` | ESM entry importing public package names and CSS. |
| `test-fixtures/packed-consumers/webpack/entry-cjs.cjs` | CommonJS entry requiring public package names. |
| `test-fixtures/packed-consumers/webpack/webpack.esm.config.cjs` | Production web build, `target: ["web", "es2018"]`, `resolve.exportsFields: []`, `mainFields: ["module", "main"]`, built-in `asset/source` CSS rule. Run `npx webpack --config webpack/webpack.esm.config.cjs`. |
| `test-fixtures/packed-consumers/webpack/webpack.cjs.config.cjs` | Same safety/target, `resolve.exportsFields: []`, `mainFields: ["main"]`, CJS entry. Run `npx webpack --config webpack/webpack.cjs.config.cjs`. |
| `test-fixtures/packed-consumers/framework-neutral/esm.mjs` | Import only core, UI, and stream-adapter in a fixture whose generated manifest has no React packages; assert no React resolves. Run with Node ESM. |
| `test-fixtures/packed-consumers/framework-neutral/cjs.cjs` | Require the same three packages with no React installed. Run with Node CommonJS. |
| `test-fixtures/packed-consumers/css/check-css.mjs` | Resolve UI package root from exported `package.json`, bypass exports by filesystem path, and verify all six CSS/declaration pairs plus relative imports/hashes. Run with Node. |
| `test-fixtures/packed-consumers/deep-import/reject.mjs` | Attempt one known existing but unexported `dist` file via package subpath and require `ERR_PACKAGE_PATH_NOT_EXPORTED`. Run with Node. |

The harness generates two exact private manifests:

1. **full consumer** — `type: module`; exact `file:` dependencies for all four tarballs; exact current React/ReactDOM 19, matching types, TypeScript, Vite, Webpack, and webpack-cli versions recorded at PR start; no workspace ranges,
2. **framework-neutral** — exact `file:` dependencies for core/UI/stream-adapter and `@cacheplane/json-stream`; no React, React DOM, React types, or React package tarball.

Each install runs `npm install --ignore-scripts --no-audit --no-fund` with a fixture-local empty cache and captured output, then `npm ls --all`. The harness rejects peer warnings, invalid/missing dependencies, workspace links, path escapes, or resolution outside that fixture's `node_modules`.

### React compatibility fixture files

| Path | Exact responsibility and command |
| --- | --- |
| `test-fixtures/react-compatibility/public-api.tsx` | Type-check a typed `Pretable` with columns/rows and one lower-level hook/model type using public imports only. |
| `test-fixtures/react-compatibility/tsconfig.nodenext.json` | Strict NodeNext, DOM+ES2018, `jsx: react-jsx`, `skipLibCheck: false`, `noEmit`. Run `npx tsc -p tsconfig.nodenext.json`. |
| `test-fixtures/react-compatibility/tsconfig.legacy.json` | Strict CommonJS/Node10 resolver, DOM+ES2018, `jsx: react-jsx`, `skipLibCheck: false`, `noEmit`. Run `npx tsc -p tsconfig.legacy.json`. |
| `test-fixtures/react-compatibility/runtime.mjs` | Create a small public `<Pretable>` via `React.createElement`, `renderToString`, install jsdom globals, hydrate with `hydrateRoot` while collecting recoverable errors, assert a grid/row, trigger one rerender, unmount, and restore globals. Run with `node runtime.mjs`. |

For each of the three exact version rows recorded in Task 1, the harness generates a private manifest with all four `file:` tarballs plus exact React, React DOM, matching type packages, TypeScript, and jsdom 30. It runs, in order:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm ls --all
npx tsc -p tsconfig.nodenext.json
npx tsc -p tsconfig.legacy.json
node runtime.mjs
```

Expected: install/stdout/stderr contain no peer conflict, both compilers exit 0, SSR markup is nonempty and deterministic, hydration reports zero recoverable errors, the post-hydration assertion passes, and unmount is clean. The React 17 negative fixture changes only React/ReactDOM/types to exact 17.x and must fail `npm install` for the declared peer floor.

### Harness unit REDs

Before either executable harness exists, its Node unit test imports only exported stubs and exercises generated command plans with fake runners/filesystems. Required initial RED cases are: unsafe temp cleanup accepted, workspace path accepted, missing tarball accepted, npm peer warning accepted, failed child status accepted, version matrix drift accepted, and missing SSR recoverable-error capture accepted. Implement pure planning/validation helpers until these unit tests are green; only then connect real process/filesystem execution and run the live tarball matrices.

## Task 1: Start from merged PR 2 and revalidate the builder

**Files:** Verify only; record findings in the PR description and commit only if they change the approved design.

- [ ] **Step 1: Synchronize onto post-PR-2 main**

Fetch and require the PR 2 merge SHA in `origin/main`, clean status, behind 0, Node `v24.19.0`, pnpm `10.12.1`, and a frozen install with no lock drift. Run `pnpm security:audit:transition` and require the exact sole finding before migration.

- [ ] **Step 2: Re-read tsdown registry metadata and release notes**

Inspect the live registry and official release notes for the reassessment candidate `0.22.14` and any newer candidate. Record:

- exact version and integrity,
- engine range (candidate baseline `^22.18.0 || >=24.11.0`),
- declaration bundler and CommonJS behavior,
- source/declaration map support,
- target and extension controls,
- clean/output semantics,
- external/noExternal matching semantics,
- package.json writing behavior,
- workspace-mode status, and
- complete audit graph after a lockfile-only trial.

Select one exact version only after proving it under Node 24.19.0. Do not use a caret because tsdown is pre-1.0. If its stable API cannot satisfy the approved contract without experimental workspace mode or hidden esbuild fallback, stop and redesign rather than approximating.

- [ ] **Step 3: Trial the selected builder in an isolated archive**

Archive `HEAD` into a unique temp directory, lockfile-add the selected exact tsdown, run a minimal dual-format build with declarations/maps and ES2018 target, inspect emitted filenames, and run `pnpm audit --json`. Remove the exact archive afterward. Do not let trial files enter the feature worktree.

- [ ] **Step 4: Record exact React compatibility matrix versions**

Resolve and record immutable test versions for:

- `react`, `react-dom`, `@types/react`, `@types/react-dom` at exact `18.0.0`,
- current React 18.x with matching current 18.x types, and
- current React 19.x with matching current 19.x types.

These versions become explicit fixture inputs. Do not use `latest` during CI.

## Task 2: Define permanent packed-artifact contracts before migration

**Files:**

- Create: `scripts/check-packed-consumers.mjs`
- Create: `scripts/__tests__/check-packed-consumers.test.mjs`
- Create: `scripts/__tests__/public-package-build-contract.test.mjs`
- Create: `test-fixtures/packed-consumers/*`
- Modify: `package.json`

- [ ] **Step 1: Design one bounded tarball harness**

The harness must:

1. create one unique temporary root,
2. pack all four public packages using `pnpm --filter <name> pack --pack-destination <temp>`,
3. validate tarball names and package versions,
4. create fixture directories under that root,
5. install from exact `file:` tarballs with scripts disabled and a clean npm cache,
6. capture status/stdout/stderr and fail on install warnings that indicate peer/dependency problems,
7. run fixture commands without workspace `NODE_PATH`, pnpm links, or source aliases,
8. assert resolved package files live beneath the fixture's `node_modules`, and
9. remove only its exact validated temporary root in `finally`.

Export pure plan/validation helpers so unit tests can cover command failure, path escape, cleanup guard, missing tarball, install warning, and workspace-link detection without performing network installs.

- [ ] **Step 2: Add artifact-layout assertions**

For each tarball require:

- only declared package files, manifest, license/readme, generated `dist`, and UI's canonical root CSS/declarations,
- ESM, CJS, ESM declarations, CJS-compatible declarations, JavaScript source maps, and declaration maps,
- no source/tests/configs/private workspace packages/node_modules,
- no emitted import or declaration referencing `@pretable-internal/*`,
- no undeclared Node builtin in browser entry points,
- manifest fields point to files actually present, and
- identical public runtime export-name sets from ESM and CJS.

Export-map-aware Node resolution must reject an unexported `@pretable/*/dist/...` import. Separately document that a legacy filesystem resolver can physically reach files named by `main`/`module`; those deep paths remain unsupported.

- [ ] **Step 3: Add parser and runtime-inventory assertions**

Parse every emitted JavaScript artifact with an explicit ES2018 grammar parser. Prefer an exact direct dev dependency such as Acorn only after auditing its graph; do not rely on an undeclared transitive. Fail on parse errors.

Parse imports/calls sufficiently to reject Node builtins and maintain an explicit browser-runtime inventory covering current bundled uses of `Object.fromEntries`, `structuredClone`, `queueMicrotask`, `ResizeObserver`, `AbortController`, `requestAnimationFrame`, and `cancelAnimationFrame`. The inventory is documentation and a review alarm, not a polyfill. Any newly discovered runtime API requires a deliberate docs/test update.

- [ ] **Step 4: Add clean consumer fixtures**

Commit small sources/configs proving:

- Node ESM import of all four packages,
- Node CommonJS require of all four packages,
- TypeScript `NodeNext` resolution,
- TypeScript legacy `Node10`/`node` resolution using `main`/`module` metadata,
- current Vite production bundling,
- current Webpack with `resolve.exportsFields: []`, an ESM build using `mainFields: ["module", "main"]`, and a CJS-oriented build using `mainFields: ["main"]`,
- framework-neutral core/UI/stream-adapter imports in a fixture with no React installed,
- UI CSS via every documented package-root path with export maps intentionally bypassed for the legacy-layout proof,
- basic tree shaking from a deliberately tiny import, and
- explicit external-boundary behavior for React, core/UI, and json-stream.

Webpack 4 is not installed or claimed. The test certifies metadata selection and current-Webpack legacy-resolution emulation only.

- [ ] **Step 5: Register permanent commands**

Add root commands with stable names, for example:

```json
{
  "consumer:check": "node ./scripts/check-packed-consumers.mjs"
}
```

Register unit/build-contract tests in the explicit root Node test list. Keep network-heavy tarball matrices out of the unit test body; invoke them as dedicated CI/local gates.

Plan the permanent GitHub enforcement at the same time: PR 3 must add both `pnpm consumer:check` and `pnpm react:compat` to the already-required `Packaging — publint + attw` job after its package build/lint steps. The release workflow must run both against freshly built packages before publish. A workflow contract test added in Task 7 locks those commands and their pre-publish ordering. They are not local-only evidence.

- [ ] **Step 6: Run RED against tsup artifacts**

Run the focused unit tests, build current packages, then run `pnpm consumer:check`. Expected RED reasons include ES2022 syntax instead of ES2018, canonical root CSS absent, and any new external-boundary contract not satisfied. Existing ESM/CJS behavior may already pass; record each sub-contract independently.

- [ ] **Step 7: Commit tests and fixtures**

Commit only test harnesses/fixtures/root registrations with message `test: define public package artifact contracts`.

## Task 3: Make UI CSS one canonical package-root source tree

**Files:**

- Move: `packages/ui/src/grid.css` -> `packages/ui/grid.css`
- Move: `packages/ui/src/tokens.css` -> `packages/ui/tokens.css`
- Move: `packages/ui/src/tailwind.css` -> `packages/ui/tailwind.css`
- Move: `packages/ui/src/themes/*.css` -> `packages/ui/themes/*.css`
- Create: matching adjacent `*.css.d.ts`
- Modify: `packages/ui/package.json`
- Delete: `packages/ui/scripts/copy-css-assets.mjs`
- Modify: CSS path consumers/tests listed in the file map

- [ ] **Step 1: Update build-config tests first**

Change UI expectations so:

- `files` includes `dist`, the three root stylesheets and declarations, and `themes`,
- CSS export-map `default` targets package-root CSS and `types` targets adjacent checked-in declaration,
- `sideEffects` matches only package-root CSS and theme CSS,
- no CSS export points into `dist`, and
- the build script contains no copy/generation step.

Add a test that the complete documented CSS set has a one-to-one adjacent declaration and no duplicate CSS exists below `src` or `dist` after build.

- [ ] **Step 2: Run focused RED**

Run UI build-config tests and expect failures against the current copied-dist layout.

- [ ] **Step 3: Move canonical files and update source-path consumers**

Move without content rewrites, then update:

- UI contract/cascade tests to resolve `packages/ui/<asset>` from their test directory,
- bench cascade Playwright path,
- website docs surface `THEMES_DIR` and source-of-truth messages,
- current code comments that point contributors to `packages/ui/src/*.css`.

Do not rewrite historical specs/plans merely because they describe the historical layout.

Each adjacent declaration contains only the stable CSS module declaration used by TypeScript. Check it in; builds must never generate or delete it.

- [ ] **Step 4: Update manifest and delete copy machinery**

Point CSS exports at canonical roots, update `files`/`sideEffects`, remove the copy script from build, and delete `copy-css-assets.mjs`. Preserve documented subpath names.

- [ ] **Step 5: Run focused GREEN and stale-artifact negative control**

Run UI tests and docs-surface tests. Then place an untracked sentinel CSS file under `dist`, run a clean UI build, and require the output directory is cleaned while every canonical root CSS hash remains unchanged; remove the sentinel. Also temporarily remove one adjacent root declaration, pack, and require the artifact contract to fail; restore it.

- [ ] **Step 6: Commit canonical CSS**

Commit the moves, declarations, manifest, tests, and current path references with message `refactor(ui): make package CSS canonical`.

## Task 4: Replace tsup with explicit tsdown package builds

**Files:**

- Create: `scripts/build/tsdown-config.ts`
- Create: `packages/{core,react,stream-adapter,ui}/tsdown.config.ts`
- Delete: `packages/{core,react,stream-adapter,ui}/tsup.config.ts`
- Modify: root and public package manifests/lockfile
- Modify: existing package build-config tests

- [ ] **Step 1: Add the exact reviewed toolchain with pnpm**

Remove root `tsup`; add exact selected tsdown and any exact audited parser/Webpack tooling required by Task 2. Use pnpm, never hand-edit the lock. Run the transition audit now and record expected temporary behavior: the former tsup finding should disappear, but the permanent zero gate is added in Task 7 after the graph is stable.

- [ ] **Step 2: Write shared-policy tests RED**

Tests must enforce actual output, not config spelling:

- ESM and CJS both emitted,
- ES2018 parse success,
- JavaScript and declaration maps emitted and reference existing sources,
- declaration conditions resolve under NodeNext and legacy TypeScript,
- output directory alone is cleaned,
- canonical UI root assets remain byte-identical,
- builds do not modify any package manifest,
- each package build script names only its own builder/config and no sibling package/filter, and
- root recursive build remains the topological orchestrator.

- [ ] **Step 3: Implement the shared typed policy**

The shared module returns a typed config fragment for:

- package public entry `src/index.ts`,
- `format: [esm, cjs]`,
- explicit ES2018 target,
- source maps,
- bundled declarations plus declaration maps,
- clean limited to `dist`,
- deterministic output extensions chosen from the verified tsdown API,
- tree shaking,
- explicit external/noExternal inputs supplied by the package, and
- no package.json/export-map generation.

Do not enable experimental workspace mode. Do not let shared config infer dependency boundaries from all manifest fields; each package config lists its architectural boundary explicitly.

- [ ] **Step 4: Implement thin package configs**

Require:

- core bundles `@pretable-internal/grid-core` and `@pretable-internal/row-model`,
- React bundles private renderer/internal workspaces and externalizes `react`, `react-dom`, `@pretable/core`, and `@pretable/ui`,
- stream-adapter externalizes `@cacheplane/json-stream`,
- UI has no CSS copy/generation and builds only JavaScript/declarations.

Set `sideEffects: false` for core, React, and stream-adapter if artifact/runtime review confirms accuracy; UI remains CSS-only side effects.

- [ ] **Step 5: Build one package at a time and inspect boundaries**

Run each package's own build independently in dependency order. Inspect emitted ESM/CJS imports and declaration references before running root build. A package script must not rebuild a sibling. Run `workspace-scripts-own-one-package.test.mjs` after every script change.

- [ ] **Step 6: Update manifest entry fields to actual reviewed output**

Point `main`, `module`, `types`, and conditional exports to the actual generated artifacts. Keep import/require declaration conditions valid for TypeScript. Filenames may change; package names/subpaths may not. Update build-config tests to the new filenames and boundary checks.

- [ ] **Step 7: Run GREEN and tsup residue controls**

Run package builds, focused build tests, `consumer:check`, publint, attw, API Extractor, and publish preflight. Search manifests/lock/config/scripts for tsup. Temporarily restore one public package's old `tsup` build script without reinstalling and require ownership/build-contract tests to fail; restore.

- [ ] **Step 8: Commit the builder migration**

Commit shared/package configs, manifests, lockfile, tests, and tsup deletions with message `build: migrate public packages to tsdown`.

## Task 5: Prove React 18 and React 19 from tarballs

**Files:**

- Create: `scripts/check-react-compatibility.mjs`
- Create: `scripts/__tests__/check-react-compatibility.test.mjs`
- Create: `test-fixtures/react-compatibility/*`
- Modify: `packages/react/package.json`
- Modify: active React-floor docs
- Modify: `package.json`

- [ ] **Step 1: Add test harness unit tests**

Cover matrix expansion, exact version enforcement, npm install warning detection, tarball path safety, command failure, missing React/type pairing, workspace resolution leakage, SSR mismatch capture, hydration cleanup, and bounded temp cleanup.

- [ ] **Step 2: Run compatibility RED before peer change**

Pack current artifacts and run exact React 18.0.0. Expected: npm peer contract rejects React 18 because package metadata still requires React 19. Capture that RED; do not use legacy-peer-deps or force.

- [ ] **Step 3: Update the peer contract**

Set both peers to:

```text
^18.0.0 || ^19.0.0
```

Do not add React runtime dependencies. Keep repository development dependencies on React 19.

- [ ] **Step 4: Implement each clean fixture**

For each exact matrix row, install all four tarballs plus exact React, React DOM, matching type packages, TypeScript, and jsdom needed by the fixture. Require:

- npm install exit 0 with no peer warning/error,
- `npm ls` valid,
- representative public API compiles with `moduleResolution: NodeNext`,
- the same source compiles with legacy Node resolution,
- server rendering produces nonempty expected markup,
- hydrateRoot completes with no recoverable hydration error,
- a small interaction/update works after hydration, and
- unmount leaves no unexpected error.

Use only public package imports. Never import workspace source or deep `dist` files.

- [ ] **Step 5: Add a React 17 negative control**

In an isolated fixture only, attempt React/ReactDOM 17 install and require a peer-contract failure. Do not use that result as a broad runtime test; it proves the declared floor.

- [ ] **Step 6: Update active documentation**

Update `README.md`, `packages/react/README.md`, and `apps/website/content/docs/getting-started/index.mdx` to say React and React DOM 18 or 19. Add the module/runtime compatibility inventory where current package docs can link to it. State:

- ESM and CommonJS package-name imports are supported,
- ES2018 is syntax only,
- named runtime APIs require platform support/polyfills,
- generic legacy resolvers are accommodated through `main`/`module`, CommonJS, ES2018 syntax, and package-root CSS; Webpack 4 itself is neither installed, tested, supported, nor certified,
- deep `dist` imports are unsupported, and
- React 17 is unsupported.

- [ ] **Step 7: Register and run the permanent matrix**

Add root `react:compat` command, run unit tests, then all three matrix rows. Commit with message `feat(react): support React 18 and 19`.

## Task 6: Complete packed-consumer, tree-shaking, and CSS evidence

- [ ] **Step 1: Run the complete packed-consumer matrix GREEN**

Build from clean output, pack fresh tarballs, and require every Task 2 fixture to pass. Record selected ESM/CJS entry paths and bundled output sizes.

- [ ] **Step 2: Prove externalization and no private leakage**

Inspect ESM/CJS and source maps. Core/React may contain bundled private implementation but no `@pretable-internal/*` import. React leaves declared public peers/dependencies external. Stream-adapter leaves `@cacheplane/json-stream` external. UI/core/stream fixture installs without React.

- [ ] **Step 3: Prove tree-shaking**

Bundle a minimal named import with Vite and Webpack ESM. Choose a reviewed, existing unique string from an unrelated implementation module and require it is absent from output. Do not add a sentinel public export, test-only branch, or marker to package source merely to make this assertion easy. Keep a coarse size ceiling only as a regression alarm with generous reviewed headroom.

- [ ] **Step 4: Prove CSS in modern and legacy layouts**

For each documented subpath, require export-map resolution succeeds, direct package-root file exists, declaration exists, content hash matches the canonical repository file, and relative imports resolve within tarball. Current Webpack with exports disabled must consume CSS through package-root paths using a built-in `asset/source` or equally dependency-free rule.

- [ ] **Step 5: Run negative controls**

One at a time, break a manifest entry, remove a CSS declaration, leak a private workspace import, raise emitted syntax above ES2018, and bundle json-stream accidentally. Require the relevant focused contract to fail, then restore intended hashes.

- [ ] **Step 6: Commit remaining harness adjustments**

If implementation required test-harness corrections that do not weaken the contract, commit them separately as `test: verify packed package consumers`.

## Task 7: Replace transition auditing with permanent zero-advisory enforcement

**Files:**

- Delete: `scripts/check-security-audit-transition.mjs`
- Delete: `scripts/__tests__/check-security-audit-transition.test.mjs`
- Modify/create: permanent audit/workflow contract tests
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add permanent gate tests RED**

Require root script `security:audit` to execute `pnpm audit --audit-level low` with no ignore/registry/suppression flags. Require CI job display name remains exactly `security-audit`, runs the permanent command, and remains in both deploy `needs`. Require the already-required `Packaging — publint + attw` job to run `pnpm consumer:check` and `pnpm react:compat` after freshly building the public packages. Require release to run the permanent audit immediately after install, then run both packed compatibility commands after build and before version/publish. Require the transition command/script/ID is absent.

- [ ] **Step 2: Replace, do not relax, the transition mechanism**

Delete transition checker/test and script entry. Add:

```json
{
  "security:audit": "pnpm audit --audit-level low"
}
```

Update CI/release to call it while retaining job/context identity and ordering. Add both permanent packed-artifact commands to the required packaging job and the pre-publish release path; do not create a green local-only contract.

- [ ] **Step 3: Run live zero audit GREEN**

Run both `pnpm security:audit` and `pnpm audit --json`. Require command exit 0, valid JSON, zero advisory entries, and zero low/moderate/high/critical totals. A registry or schema failure is a failure, never “zero.”

- [ ] **Step 4: Run lockfile negative controls**

Temporarily substitute the exact post-PR-2 lockfile to restore the sole tsup/esbuild path; require permanent gate failure. Separately use the pre-PR-2 captured lockfile in a bounded temporary checkout to prove the gate rejects the original 18-advisory graph. Restore candidate hash after each. Do not commit old lockfiles or advisory fixtures containing stale dependency state.

- [ ] **Step 5: Search for prohibited residue**

Require no tsup package/config/build script, audit transition script, advisory ID, override, patch, audit ignore, alternate registry, direct esbuild workaround, or hidden builder fallback. Supported Vite dependencies may still use an esbuild package; reject the vulnerable tsup path rather than making the false claim that the name `esbuild` cannot appear anywhere.

- [ ] **Step 6: Commit permanent enforcement**

Commit security/workflow changes with message `ci: require zero dependency advisories`.

## Task 8: Add the breaking minor Changeset and version proof

**Files:**

- Create: one `.changeset/<name>.md`

- [ ] **Step 1: Read actual versions and pending release state**

Run `pnpm exec changeset status`, inspect current public/private versions and pending changesets, and compute one minor above the actual fixed public-group baseline. Do not hardcode 0.10.0/0.11.0 from the design reassessment.

- [ ] **Step 2: Add one minor Changeset**

Frontmatter lists all four fixed public packages as `minor`. Body states:

- new supported build architecture,
- React 18 and 19 support,
- dual ESM/CommonJS package-name imports retained,
- explicit resolver/runtime contract, and
- generated filenames/deep `dist` paths are not stable or supported.

- [ ] **Step 3: Prove status**

Run branch-relative and full Changesets status. Require the fixed public group receives exactly one minor increment; private dependent app bumps may appear according to current config and must be reported, not misclassified.

- [ ] **Step 4: Run reversible version dry-run in a disposable worktree**

Create a unique bounded parent with `mktemp -d` and an exact child path such as `<parent>/version-worktree`. Add a detached worktree at feature `HEAD`, then validate it before use with `git worktree list --porcelain`: its recorded path must equal the resolved literal child path, its HEAD must equal feature `HEAD`, and it must be detached. Frozen-install there, run `pnpm exec changeset version`, and inspect generated public/private manifests and changelogs. Require all four public packages share the computed next minor and dependency ranges align.

The version command intentionally dirties only this disposable worktree. After inspection, revalidate the same path/HEAD/detached record, run `git worktree remove --force <validated-literal-child-path>`, verify it disappears from `git worktree list --porcelain`, then remove the now-empty bounded parent. The force removal is authorized only for that twice-validated disposable worktree; never point it at the feature worktree, a workspace root, an unresolved variable, or a path with pre-existing files. Verify the feature worktree HEAD, index, working tree, and recorded hashes remain byte-identical/clean.

- [ ] **Step 5: Commit the Changeset**

Commit only the new Changeset with message `chore: add package build changeset`.

## Task 9: Full local acceptance gate

- [ ] **Step 1: Fetch and require final ancestry**

Fetch/prune, require `origin/main` ancestor and behind 0, clean worktree, Node 24.19.0, frozen install with no lock drift. If upstream moved and integration is authorized, restart this complete task after integration.

- [ ] **Step 2: Run focused architecture/security gates**

Run separately:

```bash
pnpm security:audit
node --test scripts/__tests__/public-package-build-contract.test.mjs
node --test scripts/__tests__/check-packed-consumers.test.mjs
node --test scripts/__tests__/check-react-compatibility.test.mjs
pnpm consumer:check
pnpm react:compat
```

Expected: all pass from fresh tarballs/fixtures.

- [ ] **Step 3: Run complete repository gates independently**

```bash
pnpm test
pnpm typecheck
pnpm typecheck:public
pnpm typecheck:performance
pnpm lint
pnpm build
pnpm api:check
pnpm lint:packaging
pnpm publish:preflight
pnpm format
git diff --check
git diff --check origin/main...HEAD
pnpm exec changeset status --since=origin/main
pnpm exec changeset status
```

Stop at first failure. No rerun erases a failure; diagnose it.

- [ ] **Step 4: Run local website Chromium and WebKit**

Use the PR 1 artifact-preservation protocol. Build the website to terminal success, assert `BUILD_ID`, start tracked `next start` on a checked-free isolated port, wait for HTTP 200, and run Chromium and WebKit independently with explicit local `BASE_URL`, `env -u NO_COLOR`, and `--retries=0`. Stop the exact server and classify output.

- [ ] **Step 5: Run the complete local bench Chromium suite**

Build bench, start tracked Vite preview on another checked-free port, and run the full suite with `PRETABLE_BENCH_EXTERNAL_SERVER=1`, explicit local URL, one worker, Chromium, and zero retries. Stop server and restore all ignored artifacts.

- [ ] **Step 6: Audit exact final scope**

Require changes are limited to builder/package architecture, canonical CSS/path consumers, packed/React/security tests, workflows, active compatibility docs, Changeset, and approved plans/spec. Reject unrelated grid API/runtime behavior changes, historical doc rewrites, generated output, and control residue.

- [ ] **Step 7: Independent spec and quality reviews**

Ask reviewers to inspect actual tarballs and lock graph, not only configs. Resolve every Important-or-higher issue and rerun affected consumer/full gates. Perform one final self-review for public export parity, peer ranges, CSS side effects, externalization, source maps, declarations, audit ordering, and Changeset truthfulness.

## Task 10: PR, merge enforcement, release, and post-release proof

- [ ] **Step 1: Verify branch protection before push/merge**

Read classic main protection and require `security-audit` plus every context inherited from PR 2. Read rulesets too in case repository administration changed. Reuse PR 2's executable normalized comparison, not a visual check. Do not mutate unless a required context has drifted; any mutation requires the same before/after preservation protocol as PR 2.

- [ ] **Step 2: Push normally and open the PR**

PR body reports selected exact tsdown version/engine/audit, package boundaries, output contract, React matrix versions/results, CSS layout, packed fixtures, zero audit, Changeset result, local browser evidence, and explicitly narrowed legacy-bundler claim. Remove agent references.

- [ ] **Step 3: Merge only after complete green evidence**

Require stable `security-audit`, all repository checks, independent review, preview deployment/smoke when applicable, and no unexplained skips. Guarded squash merge; verify merge tree matches reviewed head.

- [ ] **Step 4: Monitor same-commit main workflows**

Require CI, CodeQL, OpenSSF, release, production deploy, and production Playwright smoke terminal success. Confirm release executes zero-audit before build/version/publish.

- [ ] **Step 5: Review and merge the generated version PR**

Verify it consumes only this Changeset plus any explicitly known pending Changesets, changes only expected version/changelog files, produces the computed fixed-group versions, and has all checks green. If unrelated runtime/API work appears, stop for authorization. Merge on green.

- [ ] **Step 6: Verify publication from the registry**

For all four public packages require:

- npm `version` and `latest` equal expected release,
- integrity/signature/provenance valid and point to the release workflow/main commit,
- the actual Changesets-created Git tag and GitHub release exist, are non-draft/non-prerelease, and resolve to the version merge (record whether the tag object is lightweight or annotated; do not require a shape the publish automation does not promise),
- fresh-cache tarball hashes match registry metadata,
- tarballs pass the same ESM/CJS/types/CSS/peer/boundary inspections, and
- a clean published-consumer install passes representative ESM, CJS, TypeScript, React 18, and React 19 smoke.

- [ ] **Step 7: Verify security and production closure**

Run live zero audit from final `main`; verify `security-audit` required and green; verify both production aliases return 200 and the deployed version endpoint identifies final main. Inspect the post-merge OpenSSF result. If its 18-vulnerability result is delayed/stale, report scanner delay with exact run/timestamp and monitor to convergence rather than declaring false closure.

- [ ] **Step 8: Final hygiene**

Verify no open/unexpected PR, release branch, package tag, temp fixture, server, port listener, generated build artifact, or dirty worktree remains. Preserve user-owned ignored artifacts exactly and provide the final merge/version/run URLs and warning classification.
