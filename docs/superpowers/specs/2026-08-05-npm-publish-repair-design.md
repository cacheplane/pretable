# npm Publish Repair Design

## Problem

The release workflow published `@pretable/react@0.0.2` with exact runtime dependencies on `@pretable/core@0.0.2` and `@pretable/ui@0.0.2`, but `@pretable/ui` does not exist on npm. The repository also advertises `@pretable/stream-adapter`, which does not exist on npm, and contains `@cacheplane/json-stream@0.0.2` while npm only has 0.0.1.

The root cause is `scripts/publish-configured-packages.mjs`. Immediately before invoking `changeset publish`, it rewrites the UI, stream-adapter, and json-stream manifests with `private: true`. This was introduced as a temporary workaround while trusted publishing was configured, but it remained in the release path after public packages began depending on the skipped packages.

## Release Repair

Backfill the missing versions from version commit `3228771e4e2887656729dff2dbc3d7f004649cfb`, the commit that assigned the versions and dependency relationships published on 2026-05-08:

- `@pretable/ui@0.0.2`
- `@pretable/stream-adapter@0.1.0`
- `@cacheplane/json-stream@0.0.2`

Build and pack these packages in a temporary worktree at that commit. Inspect the tarballs before publishing. This ensures the historical version numbers contain their historical source, rather than newer unreleased functionality currently present on main.

Before the irreversible publish, inspect each packed manifest and file list for its exact name and version, public access, transformed non-workspace dependency specifications, expected exports, and expected files. Direct tarball publication will explicitly use `npm publish <tarball> --access public --registry=https://registry.npmjs.org`; `.changeset/config.json` does not control access for a direct tarball publish. Publish json-stream before its dependent stream-adapter. Publishing is idempotent at the planning level: query each exact version immediately before publishing and skip versions that already exist. After publishing, query npm again and verify the exact versions and dependency metadata.

## UI Package Contract

The `@pretable/ui@0.0.2` tarball must contain and export all documented stylesheet entrypoints:

- `@pretable/ui/themes/excel.css`
- `@pretable/ui/themes/material.css`
- `@pretable/ui/grid.css`
- `@pretable/ui/tailwind.css`

Verification will inspect the packed file list and `package.json` exports, then validate resolution from an installed copy. `files: ["dist"]` is valid because every export targets a generated asset under `dist`; the build must run before packing.

## Future Release Pipeline

Replace the skip wrapper with a publish entrypoint that runs a preflight and then invokes `changeset publish` without mutating manifests.

The preflight will:

1. Discover workspace package manifests.
2. Select non-private packages as the publishable set.
3. Query each non-private local package's exact name and version. The same-batch set is the non-private local name/version pairs absent from the registry and therefore eligible for the imminent `changeset publish`; private packages are never batch candidates.
4. Inspect `dependencies`, `optionalDependencies`, and `peerDependencies` for `@pretable/*` entries. Exclude only `devDependencies`.
5. Resolve `workspace:` specifications to the matching local package version and validate ordinary exact or range specifications with semantic-version range matching.
6. Accept a dependency when the registry contains a version satisfying its declared specification or when the exact non-private local same-batch version satisfies it.
7. Reject unsupported dependency protocols and fail with an actionable package/dependency/specification message when no registry or same-batch version satisfies the declaration, when a local dependency is private, or when the registry cannot be checked.

The preflight will run in normal CI and again directly before publishing. Unit tests will use a local HTTP registry fixture so pass/fail behavior is deterministic and does not depend on npm availability. Fixtures will cover registry hits, same-batch dependencies, private local packages, missing versions, registry failures, dev-dependency exclusion, optional and peer dependencies, exact and range specifications, workspace specifications, and unsupported protocols.

## Verification

The repository change must pass focused preflight tests, formatting, linting, typechecking, the full test suite, build, package linting for all five public packages, and preflight against the live registry.

The final consumer proof will run in a newly created directory outside the repository:

1. `pnpm init`
2. Install exact published versions of all five advertised packages plus the React peer dependencies: `@pretable/core@0.0.2`, `@pretable/react@0.0.2`, `@pretable/ui@0.0.2`, `@pretable/stream-adapter@0.1.0`, `@cacheplane/json-stream@0.0.2`, `react`, and `react-dom`.
3. Import representative runtime exports from all five packages, including `Pretable` and `PretableSurface` from `@pretable/react`, and execute the import script.
4. Resolve the four required CSS entrypoints and verify the resolved files exist.
5. Inspect the generated lockfile and confirm every package uses a registry resolution with no workspace, link, override, patch, or local file reference.

The install must use the public registry with no overrides, links, patches, or workspace configuration.
