# Tier 1 Sub-project A — PR 1 (Infra) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install api-extractor + TSDoc tooling, wire it across all four `@pretable/*` packages, generate baseline `.api.md` snapshots that record the current public surface, and add a CI gate that fails on uncommitted drift.

**Architecture:** Single repo-root `api-extractor.base.json` defines shared config (TSDoc levels, report mode, `bundledPackages`). Each package gets its own `api-extractor.json` extending the base, plus a `tsconfig.docs.json` pointing api-extractor at the built `.d.ts`. A new `pnpm api` root script runs api-extractor in `--local` mode (regenerates `.api.md`) for development; a new CI job runs it in non-local mode (fails if committed `.api.md` is stale). No source code changes — only baseline snapshots are generated. The audit cleanup is reserved for PRs 2–5.

**Tech Stack:** `@microsoft/api-extractor` ^7.52, `@microsoft/tsdoc` ^0.15, pnpm workspaces, GitHub Actions, existing `tsup` build → `dist/index.d.ts`.

**Source spec:** `docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md`

---

## File Structure

| Path                                            | Responsibility                                                                               | Action |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| `package.json`                                  | Add devDeps (`@microsoft/api-extractor`, `@microsoft/tsdoc`) + root `api` script             | Modify |
| `api-extractor.base.json`                       | Shared api-extractor config: TSDoc reporting levels, report mode, newline, `bundledPackages` | Create |
| `packages/core/api-extractor.json`              | Core's extractor config; extends base; points at `dist/index.d.ts`                           | Create |
| `packages/core/tsconfig.docs.json`              | Tsconfig for api-extractor's compiler (extends base, includes `dist`)                        | Create |
| `packages/core/core.api.md`                     | Generated baseline public-API report                                                         | Create |
| `packages/core/package.json`                    | Add `api` script                                                                             | Modify |
| `packages/react/api-extractor.json`             | React's extractor config                                                                     | Create |
| `packages/react/tsconfig.docs.json`             | React's docs tsconfig                                                                        | Create |
| `packages/react/react.api.md`                   | Generated baseline                                                                           | Create |
| `packages/react/package.json`                   | Add `api` script                                                                             | Modify |
| `packages/ui/api-extractor.json`                | UI's extractor config                                                                        | Create |
| `packages/ui/tsconfig.docs.json`                | UI's docs tsconfig                                                                           | Create |
| `packages/ui/ui.api.md`                         | Generated baseline                                                                           | Create |
| `packages/ui/package.json`                      | Add `api` script                                                                             | Modify |
| `packages/stream-adapter/api-extractor.json`    | stream-adapter's extractor config                                                            | Create |
| `packages/stream-adapter/tsconfig.docs.json`    | stream-adapter's docs tsconfig                                                               | Create |
| `packages/stream-adapter/stream-adapter.api.md` | Generated baseline                                                                           | Create |
| `packages/stream-adapter/package.json`          | Add `api` script                                                                             | Modify |
| `.github/workflows/ci.yml`                      | Add `api-report` job that runs `pnpm api:check` after build                                  | Modify |

`.api.md` files are **not** added to any `files` array because each package's `files: ["dist"]` already excludes everything outside `dist/`. The reports stay in the repo, not in the published tarball.

---

## Task 1: Install api-extractor + TSDoc dev dependencies

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Add devDependencies**

In `package.json` (root), inside `devDependencies`, add the two packages alphabetically:

```json
"@microsoft/api-extractor": "^7.52.5",
"@microsoft/tsdoc": "^0.15.1",
```

- [ ] **Step 2: Install**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates, no errors.

- [ ] **Step 3: Verify the binary is callable**

```bash
pnpm exec api-extractor --help | head -5
```

Expected: prints "api-extractor — Microsoft API Extractor" and a usage line.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add @microsoft/api-extractor and @microsoft/tsdoc devDeps"
```

---

## Task 2: Create the root api-extractor base config

**Files:**

- Create: `api-extractor.base.json`

- [ ] **Step 1: Write the base config**

Create `api-extractor.base.json` at the repo root with this exact content:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "compiler": {
    "tsconfigFilePath": "<projectFolder>/tsconfig.docs.json"
  },
  "messages": {
    "tsdocMessageReporting": {
      "default": {
        "logLevel": "warning"
      },
      "tsdoc-undefined-tag": {
        "logLevel": "none"
      }
    },
    "extractorMessageReporting": {
      "default": {
        "logLevel": "warning"
      },
      "ae-missing-release-tag": {
        "logLevel": "warning"
      }
    }
  },
  "tsdocMetadata": {
    "enabled": false
  },
  "apiReport": {
    "enabled": true,
    "reportFolder": "<projectFolder>",
    "reportFileName": "<unscopedPackageName>.api.md"
  },
  "docModel": {
    "enabled": false
  },
  "dtsRollup": {
    "enabled": false
  },
  "newlineKind": "lf",
  "bundledPackages": [
    "@pretable/core",
    "@pretable/react",
    "@pretable/ui",
    "@pretable/stream-adapter"
  ]
}
```

Notes on the choices:

- `apiReport.enabled: true` — generates `<unscopedPackageName>.api.md` per package.
- `docModel`, `dtsRollup` disabled — we only need the report.
- `tsdocMetadata: false` — pretable doesn't ship a `tsdoc-metadata.json` file in published packages (hashbrown does because it advertises TSDoc support; we can add later).
- `ae-missing-release-tag: warning` — symbols without `@public`/`@beta`/`@internal` log a warning. PRs 2–5 will add the tags. Setting this to `error` would block PR 1.
- `tsdoc-undefined-tag: none` — silences spurious warnings on standard TSDoc tags api-extractor doesn't know about.
- `bundledPackages` — when one workspace package re-exports from another (e.g., `@pretable/react` re-exports types from `@pretable/core`), api-extractor inlines those types into the report rather than emitting a `Foo$1` import-from-other-package reference. Each `.api.md` is self-contained.

- [ ] **Step 2: Commit**

```bash
git add api-extractor.base.json
git commit -m "chore(api): add repo-root api-extractor base config"
```

---

## Task 3: Wire `@pretable/core`

**Files:**

- Create: `packages/core/tsconfig.docs.json`
- Create: `packages/core/api-extractor.json`
- Create: `packages/core/core.api.md`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Create the docs tsconfig**

Create `packages/core/tsconfig.docs.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["dist/index.d.ts"]
}
```

Why a separate file: api-extractor needs a tsconfig whose compiler can resolve types in the **built** `.d.ts`. The package's main `tsconfig.json` includes only `src/`, not `dist/`, so api-extractor would fail to find `dist/index.d.ts`. The docs config inverts that.

- [ ] **Step 2: Create the per-package extractor config**

Create `packages/core/api-extractor.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "extends": "../../api-extractor.base.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts"
}
```

- [ ] **Step 3: Build the package so dist/index.d.ts exists**

```bash
pnpm --filter @pretable/core build
```

Expected: tsup output ending with `DTS Build success`. `packages/core/dist/index.d.ts` exists after.

- [ ] **Step 4: Generate the baseline report**

```bash
pnpm exec api-extractor run --local --config packages/core/api-extractor.json
```

Expected output ends with `API Extractor completed successfully`. May print warnings about missing release tags — that's intentional (PR 2 adds the tags).

- [ ] **Step 5: Inspect the generated report**

```bash
head -20 packages/core/core.api.md
```

Expected: a markdown file starting with `## API Report File for "@pretable/core"` and listing the current exports. If the file isn't created or starts with errors, the config is wrong; debug before continuing.

- [ ] **Step 6: Add the `api` script to the package**

In `packages/core/package.json`'s `scripts` block, add:

```json
"api": "api-extractor run --local --config api-extractor.json",
"api:check": "api-extractor run --config api-extractor.json"
```

`api` (with `--local`) regenerates the report locally. `api:check` fails if the committed report is stale; CI uses this one.

- [ ] **Step 7: Verify `api:check` passes against the just-generated report**

```bash
pnpm --filter @pretable/core api:check
```

Expected: `API Extractor completed successfully` with no diff message.

- [ ] **Step 8: Commit**

```bash
git add packages/core/tsconfig.docs.json packages/core/api-extractor.json \
        packages/core/core.api.md packages/core/package.json
git commit -m "chore(core): wire api-extractor; commit baseline core.api.md"
```

---

## Task 4: Wire `@pretable/react`

**Files:**

- Create: `packages/react/tsconfig.docs.json`
- Create: `packages/react/api-extractor.json`
- Create: `packages/react/react.api.md`
- Modify: `packages/react/package.json`

- [ ] **Step 1: Create the docs tsconfig**

Create `packages/react/tsconfig.docs.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["dist/index.d.ts"]
}
```

- [ ] **Step 2: Create the per-package extractor config**

Create `packages/react/api-extractor.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "extends": "../../api-extractor.base.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts"
}
```

- [ ] **Step 3: Build the package**

```bash
pnpm --filter @pretable/react build
```

Expected: tsup ESM + CJS + DTS builds succeed.

- [ ] **Step 4: Generate the baseline report**

```bash
pnpm exec api-extractor run --local --config packages/react/api-extractor.json
```

Expected: `API Extractor completed successfully`. Warnings about missing release tags are expected.

- [ ] **Step 5: Inspect the generated report**

```bash
head -20 packages/react/react.api.md
```

Expected: starts with `## API Report File for "@pretable/react"`. Re-exports from `@pretable/core` should appear inlined (because `bundledPackages` includes core), not as `import { ... } from '@pretable/core'`.

- [ ] **Step 6: Add the `api` scripts**

In `packages/react/package.json`'s `scripts`:

```json
"api": "api-extractor run --local --config api-extractor.json",
"api:check": "api-extractor run --config api-extractor.json"
```

- [ ] **Step 7: Verify `api:check` passes**

```bash
pnpm --filter @pretable/react api:check
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/react/tsconfig.docs.json packages/react/api-extractor.json \
        packages/react/react.api.md packages/react/package.json
git commit -m "chore(react): wire api-extractor; commit baseline react.api.md"
```

---

## Task 5: Wire `@pretable/ui`

**Files:**

- Create: `packages/ui/tsconfig.docs.json`
- Create: `packages/ui/api-extractor.json`
- Create: `packages/ui/ui.api.md`
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Create the docs tsconfig**

Create `packages/ui/tsconfig.docs.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["dist/index.d.ts"]
}
```

- [ ] **Step 2: Create the per-package extractor config**

Create `packages/ui/api-extractor.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "extends": "../../api-extractor.base.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts"
}
```

- [ ] **Step 3: Build the package**

```bash
pnpm --filter @pretable/ui build
```

- [ ] **Step 4: Generate the baseline report**

```bash
pnpm exec api-extractor run --local --config packages/ui/api-extractor.json
```

Expected: `API Extractor completed successfully`. The report should be short — `getDensityHeights` and `DensityHeights` only.

- [ ] **Step 5: Inspect the report**

```bash
head -20 packages/ui/ui.api.md
```

Expected: starts with `## API Report File for "@pretable/ui"`.

- [ ] **Step 6: Add the `api` scripts**

In `packages/ui/package.json`'s `scripts`:

```json
"api": "api-extractor run --local --config api-extractor.json",
"api:check": "api-extractor run --config api-extractor.json"
```

- [ ] **Step 7: Verify `api:check` passes**

```bash
pnpm --filter @pretable/ui api:check
```

- [ ] **Step 8: Commit**

```bash
git add packages/ui/tsconfig.docs.json packages/ui/api-extractor.json \
        packages/ui/ui.api.md packages/ui/package.json
git commit -m "chore(ui): wire api-extractor; commit baseline ui.api.md"
```

---

## Task 6: Wire `@pretable/stream-adapter`

**Files:**

- Create: `packages/stream-adapter/tsconfig.docs.json`
- Create: `packages/stream-adapter/api-extractor.json`
- Create: `packages/stream-adapter/stream-adapter.api.md`
- Modify: `packages/stream-adapter/package.json`

- [ ] **Step 1: Create the docs tsconfig**

Create `packages/stream-adapter/tsconfig.docs.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["dist/index.d.ts"]
}
```

- [ ] **Step 2: Create the per-package extractor config**

Create `packages/stream-adapter/api-extractor.json`:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "extends": "../../api-extractor.base.json",
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts"
}
```

- [ ] **Step 3: Build the package**

The package's existing build script already builds `@cacheplane/json-stream` first:

```bash
pnpm --filter @pretable/stream-adapter build
```

- [ ] **Step 4: Generate the baseline report**

```bash
pnpm exec api-extractor run --local --config packages/stream-adapter/api-extractor.json
```

Expected: `API Extractor completed successfully`. Report includes `createBatcher`, `connectElementStream`, `connectPartialStream`, `parseElementStream`, `parsePartialStream`, `GridLike`, `TransactionBatcher`, `StreamConnection`, `PartialStreamOptions`.

- [ ] **Step 5: Inspect the report**

```bash
head -20 packages/stream-adapter/stream-adapter.api.md
```

Expected: starts with `## API Report File for "@pretable/stream-adapter"`.

- [ ] **Step 6: Add the `api` scripts**

In `packages/stream-adapter/package.json`'s `scripts`:

```json
"api": "api-extractor run --local --config api-extractor.json",
"api:check": "api-extractor run --config api-extractor.json"
```

- [ ] **Step 7: Verify `api:check` passes**

```bash
pnpm --filter @pretable/stream-adapter api:check
```

- [ ] **Step 8: Commit**

```bash
git add packages/stream-adapter/tsconfig.docs.json packages/stream-adapter/api-extractor.json \
        packages/stream-adapter/stream-adapter.api.md packages/stream-adapter/package.json
git commit -m "chore(stream-adapter): wire api-extractor; commit baseline stream-adapter.api.md"
```

---

## Task 7: Add root-level `api` and `api:check` scripts

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Add the aggregating scripts**

In root `package.json`'s `scripts` block, add the two scripts (sorted alphabetically with the existing entries — `api` goes near the top):

```json
"api": "pnpm --filter @pretable/core api && pnpm --filter @pretable/react api && pnpm --filter @pretable/ui api && pnpm --filter @pretable/stream-adapter api",
"api:check": "pnpm --filter @pretable/core api:check && pnpm --filter @pretable/react api:check && pnpm --filter @pretable/ui api:check && pnpm --filter @pretable/stream-adapter api:check",
```

The explicit `--filter` chain mirrors the existing `lint:packaging` script's pattern — sequential, deterministic, and trivially auditable. Don't use `pnpm -r` for this because `@cacheplane/json-stream` (filtered in by `-r`) doesn't have these scripts and would fail the run.

- [ ] **Step 2: Verify the local script works**

```bash
pnpm api
```

Expected: each of the four `api-extractor run --local` invocations prints `API Extractor completed successfully`. No `.api.md` files should change since they were just generated.

- [ ] **Step 3: Verify the check script passes**

```bash
pnpm api:check
```

Expected: same four success lines, no errors.

- [ ] **Step 4: Verify the check fails when a report is stale**

This is a smoke test for the gate. Append a single character to one report, run `api:check`, then revert.

```bash
echo "// drift sentinel" >> packages/core/core.api.md
pnpm --filter @pretable/core api:check
```

Expected: api-extractor exits non-zero with a message containing `The API report file is missing or out of date`.

```bash
git checkout packages/core/core.api.md
pnpm api:check
```

Expected: passes again.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(api): add root-level pnpm api and api:check scripts"
```

---

## Task 8: Add the CI gate

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read the existing `packaging` job structure**

Run the equivalent of `Read .github/workflows/ci.yml` and locate the `packaging:` job (around line 74 — the structure changes if the file moves, so re-locate it). Note its shape: `runs-on`, `needs: [build]`, `actions/checkout@v6`, `pnpm/action-setup@v5`, `actions/setup-node@v6` with `node-version: 22` + `cache: pnpm`, `pnpm install --frozen-lockfile`, build the published packages, run the gate. The new `api-report` job copies that shape.

- [ ] **Step 2: Add the `api-report` job**

Insert the following block immediately after the `packaging:` job in `.github/workflows/ci.yml`. The build deps mirror the `packaging` job because api-extractor reads each package's `dist/index.d.ts`:

```yaml
api-report:
  name: API Extractor — report freshness
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
    - run: pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@pretable/stream-adapter' --filter '@pretable/ui' build
    - run: pnpm api:check
```

- [ ] **Step 3: Add the new job to the deploy gate**

Find the `deploy-prod:` job's `needs:` array (around line 91 in current `ci.yml`) and add `api-report` to it so the production deploy waits on the new check. Same for `deploy-preview:` if it has a `needs:` array.

```yaml
needs: [test, typecheck, lint, format, build, packaging, api-report]
```

Search the file with `grep -n "needs: \[" .github/workflows/ci.yml` and update each entry that gates on the existing CI jobs. Do not add `api-report` to `needs:` lists for jobs that don't already gate on `packaging` (e.g., the Vercel preview-comments job).

- [ ] **Step 4: Validate YAML locally**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output (parse succeeds).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add api-report job; gate prod deploy on api:check"
```

---

## Task 9: Repo-wide gates and PR

**Files:** none (verification only)

- [ ] **Step 1: Run all repo-wide gates**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format && pnpm api:check
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm no source changes leaked in**

```bash
git diff main..HEAD -- packages/*/src apps
```

Expected: empty diff. PR 1 only adds tooling and baselines; source code in `packages/*/src` is untouched. If anything appears, it leaked in by mistake — investigate before pushing.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin api-stabilization-infra
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "chore(api): wire api-extractor + tsdoc; commit baseline .api.md per package" --body "$(cat <<'EOF'
## Summary

PR 1 of 5 for [Tier 1 Sub-project A — Public API Stabilization](../docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md). Tooling and baseline only — no source changes. The audit cleanups for each package land in PRs 2–5.

- Adds `@microsoft/api-extractor` + `@microsoft/tsdoc` devDeps.
- Adds `api-extractor.base.json` at the repo root with `bundledPackages` covering all four `@pretable/*` packages.
- Per-package `api-extractor.json` + `tsconfig.docs.json` for `@pretable/core`, `/react`, `/ui`, `/stream-adapter`.
- Generated baseline `<unscoped>.api.md` committed for each package.
- `pnpm api` (regenerate locally) and `pnpm api:check` (CI gate — fails on uncommitted drift) root scripts.
- New `api-report` CI job; production deploy now gates on it.

## Why a fail-on-drift gate is compatible with pre-1.0 ergonomics

The CI check fails only when a PR changes the public surface **and** forgets to commit the regenerated `.api.md`. Intentional surface changes pass CI as soon as the regenerated report is committed — visibility, not enforcement. The full design rationale is in the spec.

## Test plan
- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` clean
- [x] \`pnpm -w lint\` clean
- [x] \`pnpm format\` clean
- [x] \`pnpm api:check\` clean
- [x] Manually verified the gate fires when a baseline \`.api.md\` is mutated

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Set auto-merge**

```bash
gh pr merge --auto --squash
```

When all CI checks pass (including the new `api-report` job), the PR squash-merges automatically.

---

## Self-review checklist

Run through this before handing the plan to an executor:

- **Spec coverage:** §Architecture in spec covers `public_api.ts` convention, release tags, api-extractor in report mode, per-package READMEs. PR 1 implements only the api-extractor and TSDoc tooling pieces — `public_api.ts` migrations, release-tag application, and READMEs are explicitly the work of PRs 2–5 and called out as such in the PR body. No spec gaps for PR 1's scope.
- **Placeholder scan:** no `TBD`, `TODO`, "implement later", or `etc.` in any task body.
- **Type/name consistency:** the four packages and their unscoped names (`core`, `react`, `ui`, `stream-adapter`) match across every task. Script names (`api`, `api:check`) are identical at root and per-package.
- **Note on Task 8 Step 3:** the `needs:` arrays in `ci.yml` may have changed since this plan was written (around line 91 for `deploy-prod`). The step instructs the executor to grep for `needs: \[` and audit each occurrence, rather than hard-coding a line number. This is the intentional handling for "config likely to drift" cases.
