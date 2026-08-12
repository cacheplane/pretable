# Security Modernization Design

**Date:** 2026-08-11

## Outcome

Eliminate the repository's 17 known dependency advisories without suppressing,
ignoring, or misclassifying any advisory, and replace the unmaintained `tsup`
build path with a supported package architecture that serves modern consumers
without unnecessarily excluding older React, Angular, or bundler-based
applications.

The work ships as three independently reviewable pull requests:

1. establish Node.js 24 as the repository toolchain,
2. upgrade jsdom and every transitive dependency that can be fixed through a
   supported range, and
3. migrate the four public packages from tsup to tsdown while retaining a
   deliberate dual ESM/CommonJS customer contract.

Each PR must be green and merged before the next is based. A failure in one
stage must not be hidden by work from a later stage.

## Current State

At `ada90379c130345a06092359c293f32444edc620`:

- the untouched repository passes 2,368 tests,
- the root toolchain allows Node.js `>=22.0.0`,
- CI uses the floating Node.js 22 major while release uses the floating Node.js
  24 major,
- jsdom is `29.1.1`,
- the four public packages are built by unmaintained `tsup@8.5.1`,
- `pnpm audit` reports 17 advisories: 12 through `jsdom > undici`, three
  through `gray-matter > js-yaml`, one through
  `eslint-plugin-react-hooks > @babel/core`, and one through
  `tsup > esbuild`, and
- the public packages publish parallel ESM and CommonJS entry points.

The direct parents already admit patched `undici`, `js-yaml`, and
`@babel/core` releases after appropriate package/lock updates. The latest tsup
does not admit the patched esbuild major, and tsup itself is no longer actively
maintained. A permanent `tsup > esbuild` override is therefore rejected in
favor of replacing tsup.

## Product Compatibility Contract

### React

`@pretable/react` supports React and React DOM 18 and 19. Its peer dependency
contract becomes:

```json
{
  "react": "^18.0.0 || ^19.0.0",
  "react-dom": "^18.0.0 || ^19.0.0"
}
```

React 18 is the floor because the implementation relies on `useId` and
`useSyncExternalStore`. React 17 and earlier are explicitly unsupported; the
project will not carry hook shims or compatibility forks for them.

Both React 18 and React 19 must be exercised from packed, registry-shaped
artifacts. Passing only the repository's React 19 test suite is insufficient.

### Module systems and resolvers

Every public JavaScript package continues to publish both ESM and CommonJS.
ESM is canonical for modern bundlers; CommonJS is a first-class compatibility
artifact rather than an incidental build byproduct.

Each package exposes:

- a modern conditional `exports` map,
- a legacy `main` field for CommonJS resolvers,
- a legacy `module` field for ESM-aware bundlers that predate package
  `exports`,
- explicit TypeScript declaration conditions appropriate to both module
  systems, and
- only documented public subpaths.

Output filenames may change. Consumers are supported through package-name and
documented-subpath imports, not deep imports into `dist`. No compatibility is
promised for `@pretable/*/dist/*` paths.

### Emitted syntax

The build environment is Node.js 24, but the published JavaScript target is an
explicit consumer target. It must not be inferred from the build machine.

Both ESM and CommonJS output target ES2018 syntax. This keeps the packages
parseable by established application bundlers while avoiding a broad legacy
transpilation burden. Browser or Node runtime support is governed by the APIs
used by the library, not by the Node version used to build it.

### CSS

`@pretable/ui` retains its documented CSS subpaths and CSS-only side effects.
CSS files remain directly addressable by both modern export-map consumers and
legacy filesystem/module resolvers. JavaScript packages other than UI declare
`sideEffects: false` when that statement is accurate.

## PR 1: Node.js 24 Foundation

### Toolchain contract

- Pin contributor and automation use to Node.js `24.16.0`.
- Set the root engine range to the Node.js 24 line beginning at the minimum
  required by jsdom 30: `^24.15.0`.
- Add a repository version-manager file containing `24.16.0`.
- Replace every active CI and release `node-version` value with `24.16.0`.
- Keep `pnpm@10.12.1`; a pnpm upgrade is outside this program.
- Update current README and CONTRIBUTING guidance. Historical specifications
  and plans remain historical.

This PR does not add a Node engine to any published package and does not change
the package runtime contract.

### Verification

- prove commands and Actions jobs run on Node.js 24.16.0,
- run the complete repository tests, typecheck, lint, build, API Extractor,
  packaging, publish preflight, formatting, and diff checks,
- run the website Chromium and WebKit smoke suites against a production build,
- pack all public packages and run the existing registry-shaped consumer
  checks, and
- use no Changeset because published package behavior and metadata do not
  change.

## PR 2: jsdom 30 and Supported Transitive Remediation

### Dependency changes

- Upgrade jsdom to `30.0.1`. Its supported dependency graph moves undici to
  patched `8.9.0` or later.
- Resolve `js-yaml` to patched `3.15.1` through gray-matter's existing
  `^3.13.1` range.
- Resolve `@babel/core` to patched `7.29.6` through
  eslint-plugin-react-hooks' existing `^7.24.4` range.
- Do not add overrides, patches, audit ignores, or registry-error suppression.
- Do not opportunistically update unrelated root dependencies.

### jsdom migration discipline

Run the test suite first with jsdom 30 and classify every failure before
changing assertions or implementation. A changed DOM behavior may require a
product fix, a test-environment fix, or an intentionally updated expectation;
the diagnosis must identify which one. Timeouts, skipped tests, relaxed
assertions, and environment-specific branches are not acceptable substitutes.

Add focused tests for any behavior that changes, especially DOM selection,
focus, events, CSS computation, serialization, and hydration.

### Security acceptance

The original lockfile must reproduce 17 advisories. The PR lockfile must report
exactly one remaining advisory: the low-severity esbuild advisory reachable
only through tsup. The test records its ID and dependency path; it does not
ignore or dismiss it.

Until PR 3 removes tsup, CI runs `pnpm audit --audit-level moderate`, which must
pass and prevents any new moderate, high, or critical finding. A separate
machine-readable assertion must fail unless the complete audit contains exactly
the one documented esbuild finding. This is a temporary, explicit transition
contract rather than an allowlist.

### Verification

- run focused jsdom compatibility tests and negative controls,
- run all repository and browser gates from PR 1,
- verify frozen installation on a clean filesystem,
- prove no override or audit-ignore configuration exists,
- prove the lockfile contains the patched transitive versions and no vulnerable
  versions on reachable paths, and
- use no Changeset because these are repository test/build dependencies only.

## PR 3: Public Package Build Architecture

### Supported builder

Replace tsup with current tsdown. Do not carry esbuild as a direct dependency,
override, patched package, or hidden fallback. The final dependency graph must
contain neither tsup nor the vulnerable esbuild path.

Use one shared, typed build-configuration module for cross-package policy and a
thin configuration in each public package for its dependency boundaries and
assets. Do not use tsdown's experimental workspace mode. Package builds remain
individually runnable and diagnosable.

The migration utility may be run in dry-run mode as reference. Generated
configuration is not accepted without manual review and tests.

### Shared build policy

- Build ESM and CommonJS from the package public entry point.
- Emit ES2018 syntax, source maps, declarations, and declaration maps.
- Clean only the package's output directory.
- Make externalization and bundling rules explicit rather than relying on
  builder defaults.
- Do not auto-write package manifests or export maps during a build.
- Keep API Extractor as the public declaration authority.
- Keep CSS copying/generation explicit and deterministic.

### Package boundaries

- `@pretable/core` bundles its private grid internals and exposes no private
  workspace package in emitted imports or declarations.
- `@pretable/react` bundles private renderer internals; externalizes React,
  React DOM, `@pretable/core`, and `@pretable/ui`; and supports React 18 and 19.
- `@pretable/stream-adapter` externalizes `@cacheplane/json-stream` and declares
  `sideEffects: false`.
- `@pretable/ui` publishes JavaScript plus the existing typed CSS subpaths and
  limits side effects to CSS.

The public TypeScript API should remain semantically stable unless a concrete
architectural defect requires a change. Breaking changes are permitted, but
unrelated API churn is not a design goal.

### Consumer contract tests

Tests operate on freshly packed tarballs, never workspace symlinks. The matrix
must cover:

- direct Node.js ESM imports,
- direct Node.js CommonJS `require`,
- TypeScript NodeNext resolution,
- TypeScript's legacy Node resolution,
- current Vite production bundling,
- current Webpack configured to resolve through legacy `main`/`module` fields
  rather than `exports`,
- React 18 rendering and hydration,
- React 19 rendering and hydration,
- framework-neutral core, UI, and stream-adapter imports without React
  installed,
- JavaScript tree-shaking and external dependency boundaries,
- every documented UI CSS subpath, and
- absence of private workspace imports or undeclared files in tarballs.

Webpack 4 itself must not become a repository dependency: its current package
graph contains known high-severity vulnerabilities. Legacy compatibility is
verified through the same resolver fields, CommonJS entry point, ES2018 syntax,
and current Webpack's legacy-resolution mode without introducing vulnerable
test tooling. A customer-specific older toolchain can be evaluated separately
from the packed artifact when commercially necessary.

Tests must also prove that unsupported deep `dist` imports fail and that both
module formats expose the same public runtime names.

### Security gate

Add `security:audit` as a root command and required CI job. It runs at low
severity, fails on any advisory, does not ignore registry failures, and has no
ignored IDs. Negative controls restore each former vulnerable lockfile path and
prove the gate fails before restoring the intended lockfile.

The final local and GitHub evidence must show zero low, moderate, high, or
critical advisories. The post-merge OpenSSF run must close the existing
17-vulnerability Scorecard alert; scanner delay is reported rather than papered
over.

### Release semantics

Add one breaking Changeset for the fixed public package group. It must state:

- the packages now use a new supported build architecture,
- React 18 and 19 are supported by `@pretable/react`,
- dual ESM/CommonJS package-name imports remain supported,
- emitted filenames and deep `dist` imports are not stable contracts, and
- the consumer-facing module/resolver contract is explicit.

The versioning outcome must be inspected before merge. No release is published
manually from the feature branch.

## Verification and Review Rules

Each PR uses test-driven changes where behavior or a gate is introduced:

1. add or identify the test that exposes the old behavior,
2. record the failing result,
3. make the smallest architectural change for that PR,
4. run a negative control that restores the old condition,
5. restore the intended implementation, and
6. run the full independent gate.

Every PR requires:

- clean `origin/main` ancestry immediately before the gate,
- frozen installation with no lockfile drift,
- focused tests,
- full tests, typecheck, lint, build, API Extractor, packaging, publish
  preflight, formatting, and diff checks,
- scoped self-review and independent spec/quality review,
- a clean worktree,
- GitHub checks green before merge, and
- post-merge CI and release-workflow monitoring to terminal status.

Warnings are classified and reported. A warning newly introduced by the PR is
a failure unless the PR explicitly resolves or documents it as an accepted
product decision.

## Explicit Non-Goals

- React 17 or earlier support.
- Committing Webpack 4 or another known-vulnerable legacy tool to the repository.
- Preserving generated filenames or supporting deep `dist` imports.
- Preserving byte-identical bundles.
- A pnpm major upgrade.
- Changes to application features or public grid APIs unrelated to build and
  compatibility architecture.
- Suppressing CodeQL, Scorecard, npm, OSV, or pnpm audit findings.
- Action SHA pinning, workflow token-permission hardening, branch protection,
  or the separate CodeQL docs-search alert; those remain separate security
  tracks.

## Completion Criteria

The program is complete when all three PRs are merged and:

- contributors and automation run on the pinned Node.js 24 toolchain,
- jsdom 30 is green without weakened tests,
- tsup and its vulnerable esbuild path are absent,
- all 17 dependency advisories are gone with no ignores or overrides,
- `security:audit` is required and green at low severity,
- public packages pass packed-artifact ESM and CommonJS consumer tests,
- `@pretable/react` passes packed-artifact React 18 and React 19 tests,
- modern and legacy-resolution bundler tests pass,
- public tarballs pass publint, attw, API Extractor, publish preflight, and
  integrity inspection, and
- post-merge GitHub and OpenSSF evidence confirms the final state.
