# NPM Publishing Pipeline Design

## Goal

Establish a reproducible npm publishing pipeline for pretable's three public packages. Every release should be:

- **Honest**: built from a known git commit, attested via OIDC provenance, content matches what the bench measured
- **Reproducible**: anyone with checkout access can rebuild the published artifacts byte-equivalent
- **Automated**: a `pnpm changeset` invocation in a feature PR is the only manual step before npm receives a new version
- **Aligned with modern library practice**: GridBeta-style changesets workflow, dual ESM+CJS, publint+attw verification, npm provenance

## Scope

Three public packages enter npm distribution under this PR:

| Name                      | Scope         | Role                                                  |
| ------------------------- | ------------- | ----------------------------------------------------- |
| `@pretable/core`          | `@pretable`   | Framework-agnostic grid model and public types        |
| `@pretable/react`         | `@pretable`   | React adapter — public `<Pretable>` and `usePretable` |
| `@cacheplane/json-stream` | `@cacheplane` | Zero-dependency incremental JSON parser               |

These three are versioned as a **fixed group** in changesets — they always release together at the same version, even when only one has a changeset.

Out of scope:

- `@pretable-internal/*` packages (private workspace packages, `private: true`)
- `@pretable-internal/stream-adapter` and other internal seams
- Future versioning policy (semver discipline, deprecation cadence) — separate decision

## Decisions

| #   | Question               | Decision                                                          | Rationale                                                                                                            |
| --- | ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Q1  | Scope                  | All three public packages, fixed group                            | Pipeline cost is the same for one or three; ship them together once                                                  |
| Q2  | Module format          | Dual ESM+CJS                                                      | Maximum consumer compatibility; tsup makes it ~free                                                                  |
| Q3  | Initial version        | `0.0.1`, patch-only for now                                       | "Test the full development cycle" — claim the npm name without committing to API stability                           |
| Q4  | Provenance attestation | Enabled from day one                                              | Free with `id-token: write` + `NPM_CONFIG_PROVENANCE: true`; aligns with "honesty first" principle                   |
| Q5  | Internal seam handling | Extract to new `@pretable-internal/react-surface` private package | Structural public/private boundary; matches `@pretable-internal/*` convention; preserves bench measurement integrity |
| Q6  | Release flow           | `changesets/action@v1` with auto-merge of Version Packages PR     | Zero-friction releases; can revert to manual gate later if cadence demands it                                        |
| Q7  | Dist tags              | `latest` only                                                     | Single active line; `next`/`pre` tags premature at 0.0.x                                                             |

## Architecture

### Package layout after this PR

**Public packages** (npm-published, `private: false`):

| Name                      | Format       | Bundled-in (private)                                              | Runtime deps                                 | Peer deps       |
| ------------------------- | ------------ | ----------------------------------------------------------------- | -------------------------------------------- | --------------- |
| `@pretable/core`          | dual ESM+CJS | `@pretable-internal/grid-core`                                    | (none)                                       | none            |
| `@pretable/react`         | dual ESM+CJS | `@pretable-internal/{react-surface, scenario-data, renderer-dom}` | `@pretable/core` (sibling published package) | `react ^19.0.0` |
| `@cacheplane/json-stream` | dual ESM+CJS | (none)                                                            | (none)                                       | none            |

**Critical detail: bundled internal deps must be in `devDependencies`, not `dependencies`.** With `workspace:*` deps in `dependencies`, pnpm publish substitutes `workspace:*` with the workspace version (`0.0.0` for private packages). Consumers running `npm install @pretable/core` would then try to fetch `@pretable-internal/grid-core@0.0.0` from the registry — 404, broken install. Since `tsup`'s `noExternal` inlines the source at build time, the internal deps are needed only at _build_ time and belong in `devDependencies`.

**Private workspace packages** (NOT published, `private: true`):

| Name                                   | Role                                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pretable-internal/grid-core`         | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/layout-core`       | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/text-core`         | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/renderer-dom`      | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/scenario-data`     | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/bench-runner`      | (existing)                                                                                                                                                                                                      |
| `@pretable-internal/stream-adapter`    | (existing)                                                                                                                                                                                                      |
| **`@pretable-internal/react-surface`** | **NEW. Houses `PretableSurface`, `usePretableModel`, `LabeledGridSurface`, `InspectionGrid`, telemetry types — moved out of `packages/react/src/internal/`. Bench, website, streaming-demo consume from here.** |

### `exports` shape (per public package)

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
  "files": ["dist"],
  "sideEffects": false,
  "peerDependencies": {
    "react": "^19.0.0", // only @pretable/react
  },
}
```

`@pretable/react` drops the `./internal` export entirely (its source is being extracted). `./package.json` is exported because `publint` flags its absence. `sideEffects: false` enables tree-shaking for downstream bundlers.

## Internal-seam extraction

### File moves

```
packages/react/src/internal.ts                          → packages/react-surface/src/index.ts
packages/react/src/internal/inspection-grid.tsx         → packages/react-surface/src/inspection-grid.tsx
packages/react/src/internal/labeled-grid-surface.tsx    → packages/react-surface/src/labeled-grid-surface.tsx
packages/react/src/internal/pretable-surface.tsx        → packages/react-surface/src/pretable-surface.tsx
packages/react/src/internal/rendering.ts                → packages/react-surface/src/rendering.ts
packages/react/src/internal/styles.ts                   → packages/react-surface/src/styles.ts
packages/react/src/internal/__tests__/                  → packages/react-surface/src/__tests__/
```

### New `packages/react-surface/`

`packages/react-surface/package.json`:

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

ESM-only (private; no need for CJS).

### Updates to `packages/react/`

- `pretable.tsx`: `import { PretableSurface } from "./internal/pretable-surface"` → `import { PretableSurface } from "@pretable-internal/react-surface"`
- `package.json`:
  - **`dependencies`**: only `@pretable/core: workspace:*` (the sibling published package).
  - **`devDependencies`**: `@pretable-internal/react-surface`, `@pretable-internal/scenario-data`, `@pretable-internal/renderer-dom` (all `workspace:*`). These are bundled by `tsup`'s `noExternal` regex; consumers don't need them at runtime, so they must NOT appear in `dependencies` of the published manifest.
  - Drop `./internal` from `exports`.
- `tsup.config.ts`:
  - Drop `src/internal.ts` from `entry`
  - `noExternal: [/^@pretable-internal\//]` — bundle ALL internal deps into the published tarball
- `src/index.ts`: no change to public exports

### Workspace consumer updates

These four files update their imports from `@pretable/react/internal` → `@pretable-internal/react-surface`:

- `apps/bench/src/pretable-adapter.tsx`
- `apps/bench/src/bench-runtime.ts`
- `apps/bench/src/bench-app.tsx`
- `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- `apps/website/app/components/PlaygroundSection.tsx`
- `apps/streaming-demo/src/components/streaming-grid.tsx`

Their `package.json` files add `@pretable-internal/react-surface: workspace:*` to dependencies.

### Why this preserves measurement integrity

Source of truth lives in **one** place: `packages/react-surface/src/`. Workspace consumers (bench, website, streaming-demo) link to it directly via the workspace dependency. `@pretable/react` (public) also depends on it, and `tsup`'s `noExternal` regex bundles its source into the published tarball. Both paths consume identical source; the bench's wedge claims (4× scroll, 0 row-height-error) measure exactly what an `npm install @pretable/react` consumer receives.

## Build pipeline

### `@pretable/core/tsup.config.ts`

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

### `@pretable/react/tsup.config.ts`

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

### `@cacheplane/json-stream/tsup.config.ts`

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

### `@pretable-internal/react-surface/tsup.config.ts` (new)

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

### Build script convention

Each public package's `build` script keeps the existing pattern but emits dual outputs:

```jsonc
{
  "scripts": {
    "build": "pnpm --filter <internal-deps> build && tsup",
    // The standalone tsc emit step (currently `tsc -p tsconfig.build.json`) is
    // dropped — tsup's `dts: true` handles type bundling.
  },
}
```

## Verification

Aligns with GridBeta Query's per-package `test:build` pattern. Each public package gets a `lint:packaging` script:

```jsonc
{
  "scripts": {
    "lint:packaging": "publint --strict && attw --pack",
  },
}
```

Two layers of check, both run on every PR (not only at publish time):

- **`publint --strict`** — validates `package.json` shape: `main`, `types`, `exports` paths exist, no broken references, valid conditional exports.
- **`attw --pack`** — checks that TypeScript types resolve correctly under each `exports` condition (ESM, CJS, types). Catches "types work in dev but break for npm consumers".

Tooling added to root `devDependencies`:

```jsonc
{
  "@arethetypeswrong/cli": "^0.18.0",
  "publint": "^0.3.15",
}
```

### CI wiring

`.github/workflows/ci.yml` gains a `packaging` job:

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
    - run: pnpm -r --filter './packages/{core,react,json-stream}' build
    - run: pnpm -r --filter './packages/{core,react,json-stream}' lint:packaging
```

The existing `deploy-prod` and `deploy-preview` jobs both gain `packaging` to their `needs:` array, so deploys gate on packaging health.

## Changesets configuration

Updated `.changeset/config.json`:

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

Three changes:

1. **Changelog generator** — `@svitejs/changesets-changelog-github-compact` auto-links commits and PRs in GitHub-flavored style. Matches GridBeta and Radix.
2. **Fixed group** — locks the three public packages to the same version. A changeset that affects any one bumps all three.
3. **Ignore** — empty. Private packages are auto-excluded by changesets via `private: true`.

Add to root `devDependencies`:

```jsonc
{
  "@svitejs/changesets-changelog-github-compact": "^1.2.0",
}
```

### Initial release seed

The PR ships with all packages still at `0.0.0`. A `.changeset/initial-release.md` file describes the first patch bump:

```md
---
"@pretable/core": patch
"@pretable/react": patch
"@cacheplane/json-stream": patch
---

Initial release. See [`docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md`](docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for the publishing pipeline design.
```

When this PR merges to main, the release workflow opens a "chore: version packages" PR that bumps all three to `0.0.1` and writes the first changelog entries. That PR auto-merges, retriggers the workflow, which publishes 0.0.1 with provenance.

## Release workflow

`.github/workflows/release.yml` (new file):

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

### Why this shape

- **`NPM_CONFIG_PROVENANCE: true`** — tells the npm CLI to attach a provenance attestation to every published tarball. Combined with `id-token: write`, works whether we use NPM_TOKEN auth (initial state) or trusted publishing (post-first-release migration).
- **Validation runs before changesets/action** — if `typecheck` / `lint` / `test` / `build` / `lint:packaging` fail, the action never runs. No half-published state.
- **Auto-merge** — `gh pr merge --auto` ticks the auto-merge checkbox on the Version Packages PR. GitHub merges it once `ci.yml`'s required checks clear.

## First-release runbook

Manual steps that frame this PR. Some happen before merge, some after.

### Pre-merge checklist

1. **Confirm `NPM_TOKEN` is set as a repo secret.**

   ```sh
   gh secret list --repo cacheplane/pretable | grep NPM_TOKEN
   ```

   If absent: generate at `https://npmjs.com/settings/<user>/tokens` (type: **Automation**, scope: read+write for `@pretable/*` and `@cacheplane/*`). Then `gh secret set NPM_TOKEN --repo cacheplane/pretable`.

2. **Confirm npm scope ownership.**

   ```sh
   npm owner ls @pretable/core 2>/dev/null      # expect 404 — package doesn't exist yet
   npm access list packages cacheplane           # cacheplane org should exist
   ```

   If the `@pretable` scope or `@cacheplane` org isn't owned by you, the first publish will fail with `403 Forbidden`. Pre-claim by running `npm publish --dry-run` locally on each package after build.

3. **Confirm branch protection on `main` requires CI checks.**

   Auto-merge only fires when required checks pass. Repo settings → Branches → `main` → Require status checks: `test`, `typecheck`, `lint`, `format`, `build`, `packaging`.

### Post-publish runbook

After 0.0.1 lands on npm:

4. **Verify the published packages.**

   ```sh
   mkdir /tmp/pretable-smoke && cd /tmp/pretable-smoke
   npm init -y
   npm install @pretable/core@0.0.1 @pretable/react@0.0.1 @cacheplane/json-stream@0.0.1 react@^19
   node -e "const c = require('@pretable/core'); console.log(Object.keys(c))"

   # Verify provenance badge
   npm view @pretable/core@0.0.1
   # Or visit https://www.npmjs.com/package/@pretable/core/v/0.0.1
   # Should show "Built and signed on GitHub Actions" with a link to the workflow run.
   ```

5. **Configure trusted publishing on npmjs.com (per package).**

   For each of `@pretable/core`, `@pretable/react`, `@cacheplane/json-stream`:
   1. Go to `https://npmjs.com/package/<name>/access`
   2. Under "Trusted Publishers" → **Add Trusted Publisher**
   3. Set:
      - Publisher: GitHub Actions
      - Organization or user: `cacheplane`
      - Repository: `pretable`
      - Workflow filename: `release.yml`
      - Environment name: (leave blank)

   This binds the npm package to our specific workflow. Subsequent publishes don't need NPM_TOKEN — the OIDC token from `id-token: write` authenticates as a trusted publisher.

6. **Drop NPM_TOKEN reliance** (separate small PR after 0.0.2 publishes cleanly via OIDC):
   - Edit `.github/workflows/release.yml`: drop the `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}` env line from the changesets/action step.
   - `gh secret delete NPM_TOKEN --repo cacheplane/pretable`

### Troubleshooting

| Symptom                                                 | Cause                                                      | Fix                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `release.yml` fires but doesn't open Version PR         | No `.changeset/*.md` files in branch                       | Add changeset, push to feature branch, merge                            |
| Version PR opens but never auto-merges                  | Branch protection not set, or required-check name mismatch | Adjust branch-protection required checks                                |
| `npm publish` fails with 403                            | Scope not owned, or NPM_TOKEN scope/permission wrong       | Regenerate token; check scope membership                                |
| `npm publish` fails with "provenance requires id-token" | `id-token: write` permission missing on job                | Confirm `permissions:` block in release.yml                             |
| Published tarball missing files                         | tsup/`files`/exports misconfig                             | `publint` would have caught it pre-publish; check the packaging job log |

### Rollback

If 0.0.1 ships broken, npm specifically forbids unpublishing within 72 hours of upload. Use `deprecate`:

```sh
npm deprecate @pretable/core@0.0.1 "broken initial release; please use 0.0.2"
npm deprecate @pretable/react@0.0.1 "broken initial release; please use 0.0.2"
npm deprecate @cacheplane/json-stream@0.0.1 "broken initial release; please use 0.0.2"
```

Then push a fix + new changeset → 0.0.2.

## Alignment with reference projects

| Aspect                    | GridBeta Query/Router             | Dawn                             | This design                                                                                                                                    |
| ------------------------- | --------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Versioning tool           | changesets                        | changesets                       | changesets                                                                                                                                     |
| Version model             | fixed groups                      | individual                       | fixed group (3 packages)                                                                                                                       |
| Module format             | dual ESM+CJS                      | (varies)                         | dual ESM+CJS                                                                                                                                   |
| Package verification      | `publint --strict && attw --pack` | publint + tarball-manifest check | `publint --strict && attw --pack` (no manifest check; matches GridBeta)                                                                        |
| Release action            | `changesets/action@v1`            | `changesets/action@v1`           | `changesets/action@v1`                                                                                                                         |
| Provenance                | `NPM_CONFIG_PROVENANCE`           | `NPM_CONFIG_PROVENANCE`          | `NPM_CONFIG_PROVENANCE`                                                                                                                        |
| Trusted publishing        | OIDC via id-token                 | NPM_TOKEN                        | NPM_TOKEN initially → OIDC trusted publishing after 0.0.1 (manual setup)                                                                       |
| Auto-merge Version PR     | manual                            | manual                           | auto-merge via `gh pr merge --auto`                                                                                                            |
| Internal-package handling | publish all separately            | publish all separately           | bundle internals into public packages via `tsup noExternal` (our case is unique — pretable wants a small public surface, large private engine) |

The internal-bundling pattern is the only meaningful divergence. GridBeta and Dawn both publish every workspace package separately. Pretable's deliberate choice (per `repo-memory.md`) is to keep the engine internal until the public API is stable; bundling is the mechanism that makes that work without exposing the seam.
