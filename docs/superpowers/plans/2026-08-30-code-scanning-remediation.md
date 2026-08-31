# Code-Scanning Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate every actionable code-scanning alert on `main` without suppressions, mutable dependencies, permission broadening, or publishing regressions.

**Architecture:** Deliver the runtime sanitization fix separately from workflow hardening so each can be reviewed and rolled back independently. Enforce the workflow result with local fail-closed policy tests and verify the final alert state through GitHub's API.

**Tech Stack:** TypeScript, Vitest, GitHub Actions YAML, Node's test runner, `yaml`, pnpm 10, Node 24, GitHub CodeQL and OpenSSF Scorecard.

---

### Task 1: Search-index sanitization PR

**Files:**
- Modify: `apps/website/lib/docs/search-index.ts`
- Modify: `apps/website/lib/docs/__tests__/search-index.test.ts`

- [x] Write direct failing tests with exact output contracts: ordinary tags lose only tag syntax and retain their text; nested/adversarial tags cannot leave or reconstruct `<script`; and `before <script after` becomes `before ` because an unterminated tag consumes the remainder.
- [x] Run `pnpm --filter @pretable/app-website exec vitest run lib/docs/__tests__/search-index.test.ts` and confirm the adversarial test fails against the regex implementation.
- [x] Replace the multi-character tag-removal regex with a single-pass helper that never copies `<` or tag contents into the output.
- [x] Re-run the focused test and website validation lanes.
- [x] Commit, push, open a focused PR with an in-scope alert disposition table and evidence; request an eligible reviewer or record the sole-collaborator limitation; and merge only after required checks are green.
- [x] After merge, wait for the same-commit default-branch CodeQL run to succeed, then refresh `main` and the live inventory and verify alert 1 closed through analysis rather than dismissal.

### Task 2: Workflow supply-chain policy tests

**Files:**
- Create: `scripts/__tests__/workflow-security-policy.test.mjs`
- Modify: `package.json`

- [x] Write a failing repository-wide test that rejects every remote `uses:` reference not pinned to a 40-character commit SHA.
- [x] Add a failing permission-policy test that rejects top-level write permissions and any job-level write permission outside the explicit least-privilege allowlist.
- [x] Add release assertions that its `GITHUB_TOKEN` has only `contents: read` and `id-token: write`, its PAT is absent from job-wide environment, and no `GITHUB_TOKEN` fallback can perform release writes.
- [x] Register the policy test in the root `test` command and prove the new tests fail on the baseline workflows.

### Task 3: Immutable action references

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/prod-freshness.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/scorecard.yml`
- Modify: `scripts/__tests__/security-audit-workflow-contract.test.mjs`

- [x] Resolve and record the exact commits behind the currently used action versions.
- [x] Replace all 68 mutable action references with those full SHAs and preserve version comments.
- [x] Update every production expectation and affected mutation fixture in the existing workflow contract, including the hard-coded CI checkout, pnpm setup, and Node setup refs as well as release refs.
- [x] Run the focused workflow tests and confirm every remote action passes the pin policy.

### Task 4: Token-permission hardening

**Files:**
- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/__tests__/security-audit-workflow-contract.test.mjs`
- Modify: `scripts/__tests__/workflow-security-policy.test.mjs`

- [x] Move CodeQL's write grant from workflow scope and give the analysis job exactly `actions: read`, `contents: read`, and `security-events: write`.
- [x] Add `contents: read` at release workflow scope.
- [x] Change the release job's `GITHUB_TOKEN` permissions to `contents: read` and `id-token: write`, removing repository-write grants.
- [x] Inspect and record non-secret repository/account metadata for `RELEASE_GITHUB_TOKEN`. GitHub exposes that the repository secret exists and its update date, but not the credential's grants, repository selection, or expiration; report that limitation explicitly rather than claiming the credential itself is least-privilege.
- [x] Remove the release PAT from job-wide environment and pass it only to Changesets and the conditional auto-merge step; remove the `GITHUB_TOKEN` fallback.
- [x] Preserve and re-test the npm-token absence guard, provenance flag, npm OIDC floor, Node 24, and publish command.
- [x] Run focused workflow contract and policy tests until green.

### Task 5: Fail-closed deployment capture

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/__tests__/workflow-security-policy.test.mjs`

- [x] Reproduce from the sanitizer PR logs that a nonzero Vercel CLI exit was hidden by `tail -n 1` and produced an empty preview URL.
- [x] Enable `pipefail` for both preview and production deployment pipelines.
- [x] Reject empty or non-HTTPS deployment output before publishing it as a job output.
- [x] Add policy assertions for both deploy jobs and run the focused tests until green.

### Task 6: Workflow PR verification and delivery

**Files:**
- Modify: PR description only

- [ ] Run `pnpm security:audit`, `pnpm test`, `pnpm typecheck`, `pnpm typecheck:public`, `pnpm typecheck:performance`, `pnpm lint`, `pnpm format`, `pnpm build`, `pnpm api:check`, `pnpm lint:packaging`, `pnpm consumer:check`, `pnpm react:compat`, and `pnpm publish:preflight`.
- [ ] Confirm no remote workflow action uses a mutable ref and inspect the complete diff.
- [ ] Commit and push the workflow PR with an alert-by-alert grouped disposition table and verification evidence.
- [ ] Request review if an eligible second collaborator exists; otherwise document why GitHub cannot accept a self-review.
- [ ] Enable squash auto-merge only after required checks pass.
- [ ] After merge, wait for same-commit default-branch main CI, Release, CodeQL, and Scorecard runs to succeed. Treat the no-changeset Release result only as a runtime smoke of the workflow and OIDC preconditions—not proof of PAT writes, a real npm OIDC exchange, or provenance—then refresh the live inventory, verify remediated alerts closed through analysis rather than dismissal, and report every residual alert with its evidence-backed reason.
