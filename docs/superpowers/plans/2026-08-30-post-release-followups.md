# Post-release Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the approved dependency, correctness, and performance follow-ups as independently verified green-on-merge changes.

**Architecture:** Dependency updates remain isolated by compatibility boundary; the release Action follows the CLI migration. The sole new product fix defines scroll authority at the React/controller seam. Already-shipped issue work is verified against current main before issue closure.

**Tech Stack:** Node 24.19.0, pnpm 10.12.1, TypeScript 6, React 18-19, Vitest, Playwright, Changesets, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-post-release-followups-design.md`

---

### Task 1: Commit and merge the follow-up design

**Files:**
- Create: `docs/superpowers/specs/2026-08-30-post-release-followups-design.md`
- Create: `docs/superpowers/plans/2026-08-30-post-release-followups.md`

- [ ] Run `pnpm prettier --check docs/superpowers/specs/2026-08-30-post-release-followups-design.md docs/superpowers/plans/2026-08-30-post-release-followups.md`.
- [ ] Review the two documents against the GitHub issue and PR state.
- [ ] Commit, push, open a documentation PR, wait for required checks, and squash-merge.

### Task 2: Repair and merge dependency group PR #538

**Files:**
- Modify: `status/milestones/2026-08-15-s2-comparative-rebaseline.json`
- Existing PR files: `package.json`, `pnpm-lock.yaml`, `apps/bench/package.json`, `apps/website/package.json`
- Test: `scripts/__tests__/bench-comparator-provenance.test.mjs`

- [ ] Refresh the PR branch from current `main` without force-pushing unrelated history.
- [ ] Reproduce the provenance failure with `node --test scripts/__tests__/bench-comparator-provenance.test.mjs`.
- [ ] Add an `adapterVersions.superseded` block naming MUI Data Grid, MUI Material, TanStack Table, and TanStack Virtual version drift; leave recorded versions unchanged.
- [ ] Re-run the provenance test and inspect the complete PR diff.
- [ ] Run `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`, `pnpm security:audit`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`, `pnpm api:check`, `pnpm consumer:check`, `pnpm react:compat`, and `pnpm lint:packaging`.
- [ ] Push, wait for every required check, and squash-merge PR #538.

### Task 3: Review and merge Changesets CLI 3 PR #474

**Files:**
- Existing PR files: `package.json`, `pnpm-lock.yaml`
- Inspect: `.changeset/config.json`, `scripts/publish-configured-packages.mjs`, `scripts/publish-preflight.mjs`
- Test: `scripts/__tests__/publish-public-packages.test.mjs`, `scripts/__tests__/publish-preflight.test.mjs`

- [ ] Read the official CLI 3 release and migration notes and compare them to the repository configuration and custom publish wrapper.
- [ ] Refresh the PR branch from current `main`.
- [ ] Run the focused publish/preflight tests and safe CLI commands (`changeset status`, config parsing, and a disposable versioning fixture if needed).
- [ ] Run the full verification matrix from Task 2.
- [ ] Push any required compatibility fixes, wait for green checks, and squash-merge PR #474.

### Task 4: Resolve fuzzysort 4 PR #472

**Files:**
- Existing PR files: `apps/website/package.json`, `pnpm-lock.yaml`
- Modify/Test: website search modules and their existing tests discovered with `rg -n "fuzzysort" apps/website`

- [ ] Read the official fuzzysort 4 migration notes.
- [ ] Refresh the PR branch and run existing focused search tests to establish the failure or compatibility baseline.
- [ ] Add a regression for every behavior affected by the v4 API change before changing production code.
- [ ] Implement the minimal migration, verify red-green, then run website, typecheck, build, smoke, and full repository gates.
- [ ] Push, wait for green checks, and squash-merge PR #472.

### Task 5: Resolve jest-dom 7 PR #475

**Files:**
- Existing PR files: `package.json`, `pnpm-lock.yaml`
- Inspect: every Vitest setup file and `tsconfig` matcher-type entry returned by `rg -n "jest-dom" .`

- [ ] Read the official jest-dom 7 migration notes and engine requirements.
- [ ] Refresh the PR branch and run representative React, UI, bench, and website DOM suites.
- [ ] Add a focused type/runtime regression before any setup migration required by v7.
- [ ] Run all DOM suites plus the full repository gates.
- [ ] Push, wait for green checks, and squash-merge PR #475.

### Task 6: Migrate Changesets Action 2 in PR #476

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `scripts/__tests__/security-audit-workflow-contract.test.mjs`, `scripts/__tests__/node-toolchain-contract.test.mjs`

- [ ] Refresh from `main` after CLI 3 merges and read the official Action 2 migration notes.
- [ ] Write failing workflow-contract assertions for `version-script`, `publish-script`, `pr-title`, `commit-message`, `github-token`, `pr-number`, and the required output-file propagation.
- [ ] Migrate the workflow with no npm token and no weakening of OIDC guards.
- [ ] Run focused workflow tests, full repository gates, and a non-publishing release dry inspection.
- [ ] Push, wait for green checks, and squash-merge PR #476.

### Task 7: Fix scroll authority issue #524

**Files:**
- Modify: `packages/react/src/pretable-model.ts`
- Test: create `packages/react/src/__tests__/scroll-authority.test.tsx` or extend the narrowest existing controller-seam test after investigation
- Inspect: `packages/renderer-dom/src/row-layout-controller.ts`, `packages/react/src/pretable-surface.tsx`

- [ ] Trace user scroll, grid viewport, controller viewport, anchor restore, and status-change data flow on current `main`.
- [ ] Write a React integration regression that reproduces stale viewport re-feed after an anchor-adjusting publish; confirm it fails for the #524 reason.
- [ ] Make status-only controller publications unable to reassert stale DOM scroll while preserving legitimate viewport feeds.
- [ ] Confirm the regression passes, mutation-check by restoring the old dependency/behavior, then restore the fix and run React plus renderer focused suites.
- [ ] Run full repository gates and Chromium/WebKit smoke tests.
- [ ] Push a dedicated PR, wait for green checks, squash-merge, and close #524 through the PR.

### Task 8: Verify and close #491

**Files:**
- Existing test: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`

- [ ] Run the focused journal-anchor test on current `main`.
- [ ] Confirm PR #508's merge commit is an ancestor of current `main` and inspect the exact anchor ladder.
- [ ] Comment with the test evidence and close #491 as completed.

### Task 9: Re-measure and close #452

**Files:**
- Generated/committed measurement only if the bench workflow requires it: `status/runsets/*`, `status/milestones/*`

- [ ] Check the machine for a quiet measurement window.
- [ ] Run Chromium S2 hypothesis sort, filter-metadata, and filter-text for Pretable and TanStack with at least three repeats in the same runset.
- [ ] Compare interaction latency and correctness metrics to the original issue and PR #479/#487 evidence.
- [ ] If the gap remains closed, comment exact results and close #452; if not, keep it open and write a new evidence-based implementation plan before changing code.

### Task 10: Final main and production audit

- [ ] Pull latest `main` into a fresh verification worktree.
- [ ] Run security audit, full tests, typecheck, lint, format, build, API, packaging, packed consumers, React compatibility, and Chromium/WebKit smoke.
- [ ] Verify npm package dist-tags and the latest main CI, CodeQL, Scorecard, release, and production-deploy checks.
- [ ] Review open PRs/issues for superseded dependency branches or newly exposed blockers and report the final handoff.
