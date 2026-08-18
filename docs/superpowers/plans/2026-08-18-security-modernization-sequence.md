# Security Modernization Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved dependency and package-build modernization as three independently green, sequential pull requests with no advisory suppression and no compatibility shortcut.

**Architecture:** Node 24 is established first, jsdom and supported transitives are repaired second, and only then are public packages moved from tsup to a dual ESM/CommonJS tsdown architecture. Each PR branches from the prior merged `main`, owns one risk domain, and is verified and merged before the next begins.

**Tech Stack:** Node.js 24.19.0, pnpm 10.12.1, GitHub Actions, jsdom 30, tsdown, TypeScript, Vitest, Playwright, npm package tarballs, Vite, Webpack, Changesets.

---

## Authoritative documents

| Document | Responsibility |
| --- | --- |
| `docs/superpowers/specs/2026-08-11-security-modernization-design.md` | Approved product, security, compatibility, and release contract. |
| `docs/superpowers/plans/2026-08-18-security-modernization-pr1-node24.md` | PR 1 execution: pin the contributor and automation toolchain to Node 24. |
| `docs/superpowers/plans/2026-08-18-security-modernization-pr2-jsdom-audit.md` | PR 2 execution: jsdom 30, supported transitive remediation, and exact transition audit enforcement. |
| `docs/superpowers/plans/2026-08-18-security-modernization-pr3-package-builds.md` | PR 3 execution: tsdown, packed-consumer compatibility, React 18 floor, canonical CSS, and permanent zero-audit enforcement. |

The design wins if a plan and the design disagree. Stop and amend the plan through review rather than silently changing scope during implementation.

## Program invariants

- [ ] Use a dedicated worktree and a `blove/` branch for each implementation PR.
- [ ] At the start of every PR, fetch `origin`, require a clean worktree, and record `origin/main`, `HEAD`, and ahead/behind counts.
- [ ] Branch PR 1 from current `origin/main`; branch PR 2 only from `main` containing merged PR 1; branch PR 3 only from `main` containing merged PR 2.
- [ ] If `origin/main` advances during a final gate, inspect the upstream diff, integrate it only with explicit authorization, and restart the complete gate on the final graph.
- [ ] Never carry an uncommitted fix, lockfile edit, audit exception, package override, timeout increase, skipped test, or relaxed assertion from one PR to another.
- [ ] Keep the stable GitHub check name `security-audit` from PR 2 onward. PR 3 changes its implementation, not its identity.
- [ ] Do not publish packages from a feature branch. Release automation owns versioning and publication after merge.
- [ ] Monitor each PR's required checks to terminal state before merging, then monitor same-commit `main` CI, release, CodeQL, OpenSSF, production deployment, and Playwright smoke to terminal state.
- [ ] Record warnings and classify them. A warning introduced by the PR is a failure unless the PR deliberately resolves or documents it as an approved contract change.

## Pull-request sequence

### PR 1 — Node 24 foundation

- [ ] Execute `2026-08-18-security-modernization-pr1-node24.md` completely.
- [ ] Use no Changeset.
- [ ] Require all local gates, packed-package smoke, local website Chromium/WebKit, and local bench Chromium to pass.
- [ ] Open a focused PR, obtain independent spec and quality review, merge only on green, and verify post-merge automation.
- [ ] Record the merge SHA. PR 2 must prove that SHA is in its `origin/main` ancestry.

### PR 2 — jsdom and advisory transition

- [ ] Execute `2026-08-18-security-modernization-pr2-jsdom-audit.md` completely from post-PR-1 `main`.
- [ ] Use no Changeset.
- [ ] Preserve the exact final manifest scope: only the direct jsdom declaration changes; supported transitive remediation lives in the pnpm-generated lockfile.
- [ ] Add and verify the stable `security-audit` CI context.
- [ ] Before merge, add only `security-audit` to classic branch protection's required contexts and prove all previous protection settings remain unchanged.
- [ ] Merge only when the lockfile has exactly advisory `1120680`, finding version `0.27.7`, and sole path `.>tsup>esbuild`, with no other advisory, version, or path.
- [ ] Verify post-merge CI/release enforcement and record the merge SHA. PR 3 must prove that SHA is in its `origin/main` ancestry.

### PR 3 — package-build architecture and zero advisories

- [ ] Execute `2026-08-18-security-modernization-pr3-package-builds.md` completely from post-PR-2 `main`.
- [ ] Revalidate the exact tsdown version, engines, release notes, and audit graph at PR start; do not assume the reassessment candidate is still appropriate.
- [ ] Add one minor Changeset for the fixed public group, relative to actual versions at branch time.
- [ ] Prove React 18.0.0, current React 18, and current React 19 from clean packed-artifact fixtures with matching types, runtime SSR/hydration, and both TypeScript resolver modes.
- [ ] Preserve first-class ESM and CommonJS package-name imports, explicit legacy `main`/`module` metadata, ES2018 syntax, and canonical package-root CSS.
- [ ] Replace the transition checker with the permanent zero-advisory gate while retaining the required `security-audit` context.
- [ ] Verify branch protection still requires the context and still preserves every prior setting.
- [ ] Merge only on green; monitor version PR and publication. Verify registry tarballs, provenance, tags, releases, production, and OpenSSF advisory closure.

## Program completion audit

- [ ] Fetch final `origin/main` and verify all three merge SHAs are ancestors.
- [ ] Verify all active `actions/setup-node` steps and repository version metadata pin Node 24.19.0.
- [ ] Verify `pnpm audit --json` is valid and contains zero advisories at every severity.
- [ ] Verify no audit ignore, override, patch, registry-error suppression, tsup dependency, tsup config, or tsup build script remains.
- [ ] Verify the vulnerable finding version `0.27.7` at path `.>tsup>esbuild` is absent. Do not assert that all esbuild usage is absent when supported tools such as Vite may legitimately depend on a patched/non-advisory path.
- [ ] Verify all four public packages resolve to the same fixed-group release version and their registry tarballs match the approved module, declaration, dependency, CSS, and React-peer contracts.
- [ ] Verify `security-audit` is green on final `main`, required by branch protection, and included in preview deploy, production deploy, and release dependency paths.
- [ ] Verify no unexpected PR, release branch, package publication, tag, or GitHub release was created.
- [ ] Leave every implementation worktree clean and report any intentionally retained local artifacts.
