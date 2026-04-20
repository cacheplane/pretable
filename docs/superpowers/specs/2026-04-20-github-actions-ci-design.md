# GitHub Actions CI Design

## Goal

Add a GitHub Actions CI workflow that runs quality checks on pull requests to main, preparing for a branch-protection-based development workflow.

## Current Behavior

No CI exists. All verification is manual (`pnpm test`, `pnpm typecheck`, etc.) run locally before pushing directly to main.

## Target Behavior

A single workflow file (`.github/workflows/ci.yml`) triggers on pull requests to `main` and runs five parallel jobs. Each job reports its own pass/fail status, giving immediate visibility into which check failed.

## Workflow Configuration

**Trigger:** Pull requests targeting `main`.

**Concurrency:** Cancel in-progress runs when a new push arrives on the same PR branch:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

## Jobs

| Job | Command | Purpose |
|-----|---------|---------|
| `test` | `pnpm test` | Unit tests (node:test for scripts, vitest for packages/apps) |
| `typecheck` | `pnpm typecheck` | TypeScript type checking across all packages and apps |
| `lint` | `pnpm lint` | ESLint across all packages |
| `format` | `pnpm format` | Prettier formatting check |
| `build` | `pnpm build` | Full build (packages then apps, including Vite bundling) |

All five jobs run in parallel with no dependencies between them.

## Job Setup (shared across all 5 jobs)

Each job uses the same runner and setup steps:

```yaml
runs-on: ubuntu-latest
steps:
  - uses: actions/checkout@v4
  - uses: pnpm/action-setup@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: pnpm
  - run: pnpm install --frozen-lockfile
  - run: <job-specific command>
```

- `pnpm/action-setup@v4` reads the `packageManager` field from `package.json` to determine the pnpm version (10.12.1).
- `actions/setup-node@v4` with `cache: 'pnpm'` caches the pnpm store across workflow runs.
- `pnpm install --frozen-lockfile` ensures deterministic installs matching the lockfile.

## Changes

### .github/workflows/ci.yml (new)

Single workflow file containing all five parallel jobs as described above.

## What This Does Not Include

- Playwright/bench E2E — too heavy for every PR (browser download, preview server). Kept as manual verification.
- Deployment — no production deployment target yet.
- Branch protection rules — the workflow makes checks available; locking down main is a separate manual GitHub settings step.
- Changesets/release automation — out of scope.
- Multiple Node versions or OS matrix — unnecessary for an application monorepo targeting one runtime.

## Verification

1. Create a PR with the workflow file.
2. Observe all 5 jobs trigger and pass on GitHub Actions.
3. Each job reports independent pass/fail status.
4. Pushing a new commit to the PR cancels the previous run (concurrency group).

## Risk

Minimal. This adds a new file (`.github/workflows/ci.yml`) with no impact on existing code or local development. The only risk is a job failing due to environment differences (e.g., a Linux-specific issue not caught on macOS) — this would be surfaced immediately on the first PR and fixed.
