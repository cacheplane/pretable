# Security Modernization PR 2: jsdom and Audit Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade to jsdom 30, resolve every advisory admitted by supported dependency ranges, and make the sole remaining tsup/esbuild advisory an exact fail-closed transition contract enforced in CI, release, deployment, and branch protection.

**Architecture:** pnpm produces the dependency graph through temporary exact pins that leave no committed manifest residue. A tested Node checker accepts one fully specified low-severity audit record and rejects every schema, process, registry, advisory, path, version, or severity drift. The stable `security-audit` check is introduced now and becomes zero-advisory enforcement in PR 3.

**Tech Stack:** Node.js 24.19.0, pnpm 10.12.1, jsdom 30.0.1, Node test runner, Vitest, Playwright, GitHub Actions, GitHub branch-protection API.

---

## File map

| File | Responsibility |
| --- | --- |
| `package.json` | Upgrade jsdom, register transition scripts/tests; no retained transitive pins. |
| `pnpm-lock.yaml` | pnpm-generated patched dependency graph. |
| `scripts/check-security-audit-transition.mjs` | Execute and validate the exact one-advisory transition state. |
| `scripts/__tests__/check-security-audit-transition.test.mjs` | Fail-closed unit and integration contract for audit parsing. |
| `.github/workflows/ci.yml` | Add stable `security-audit` job and make preview/production deploys depend on it. |
| `.github/workflows/release.yml` | Run the same transition gate after frozen install and before any build/version/publish step. |
| Focused jsdom test files discovered during RED classification | Only intentional product or environment-contract fixes demonstrated by focused regressions. |

No Changeset is required: jsdom and the remediated transitives are repository test/build dependencies. Any proposed publishable runtime change is out of scope and must stop the PR for redesign.

## Task 1: Start from merged PR 1 and reproduce the advisory baseline

**Files:** Verify only.

- [ ] **Step 1: Synchronize onto post-PR-1 main**

Run:

```bash
git status --short --branch
git fetch --prune origin
git merge-base --is-ancestor <PR1_MERGE_SHA> origin/main
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
node --version
pnpm --version
```

Expected: clean, PR 1 merge is in `main`, branch behind 0, Node `v24.19.0`, pnpm `10.12.1`.

- [ ] **Step 2: Frozen-install without lock drift**

Hash `pnpm-lock.yaml`, run `pnpm install --frozen-lockfile`, re-hash, and require equality plus clean status.

- [ ] **Step 3: Capture the live original audit payload**

Run `pnpm audit --json` while capturing stdout, stderr, and exit status separately in a unique `/tmp` directory. Do not pipe away the process status. Parse only valid JSON and record:

- total findings: 18,
- 12 `jsdom > undici`,
- three `gray-matter > js-yaml`,
- one `eslint-plugin-react-hooks > @babel/core`,
- one `tsup > postcss > nanoid`, and
- one `tsup > esbuild`.

If the registry's live advisory set or paths differ, stop and reassess the approved transition contract before changing dependencies.

- [ ] **Step 4: Capture baseline jsdom warning categories**

Run these separately with `set -o pipefail`, retaining complete output outside the repository:

```bash
pnpm --filter @pretable/react test
pnpm --filter @pretable/app-bench test
pnpm --filter @pretable/app-website test
```

Classify warning categories and counts, especially canvas `getContext`, navigation “not implemented,” hydration/recoverable errors, CSS parsing/computation, focus, and event warnings. This is comparison evidence, not a snapshot to blindly match; preserve test names and related behavior.

## Task 2: Build the fail-closed transition checker test-first

**Files:**

- Create: `scripts/check-security-audit-transition.mjs`
- Create: `scripts/__tests__/check-security-audit-transition.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Capture the exact pnpm 10 audit schema in a minimal fixture builder**

Use the valid live JSON payload to identify the required top-level `advisories` and `metadata.vulnerabilities` structure and the advisory's `findings[].paths`. Do not commit registry URLs, tokens, cache paths, timestamps, or the entire 18-advisory payload. Build compact in-test objects that retain every field used for validation.

- [ ] **Step 2: Write failing validator tests**

Export a pure validator that receives `{ status, signal, error, stdout, stderr }`. Add tests requiring:

1. the exact transition payload is accepted,
2. zero advisories is rejected while PR 2's transition checker exists,
3. another advisory ID is rejected,
4. another dependency path is rejected,
5. another affected esbuild version is rejected,
6. another severity is rejected,
7. duplicate findings or paths are rejected,
8. contradictory vulnerability totals are rejected,
9. malformed/truncated JSON is rejected,
10. missing required schema is rejected,
11. registry/error payloads are rejected,
12. spawn errors, signals, null status, and unexplained process statuses are rejected, and
13. stderr that indicates a registry/process failure is rejected rather than interpreted as the known advisory.

The one accepted record must be advisory `1120680`, the live confirmed low severity, `findings[0].version === "0.27.7"`, and `findings[0].paths` exactly `['.>tsup>esbuild']`. Compare exact sets and fields, not a synthetic path that appends the version or an `includes` fragment.

- [ ] **Step 3: Run the validator RED**

Create only exported function signatures/stubs needed for the test module to load, then run:

```bash
node --test scripts/__tests__/check-security-audit-transition.test.mjs
```

Expected: the exact-transition case and rejection cases fail because validation is not implemented. Record representative failures; a module-not-found or syntax error is not the intended RED.

- [ ] **Step 4: Implement the pure validator and run unit GREEN**

Implement exact validation of process status/signal/error, parseable pnpm schema, module/advisory identity, low severity, finding version `0.27.7`, sole path `.>tsup>esbuild`, no duplicate advisory/finding/path, and internally consistent zero/low/moderate/high/critical totals. Reject any unexplained stderr or top-level registry/error payload. Run the focused unit test and require every accept/reject case to pass before adding child-process execution.

- [ ] **Step 5: Write the executable wrapper**

The executable must synchronously run `pnpm audit --json` without a shell, capture status/stdout/stderr with a bounded buffer, call the pure validator, print a concise confirmed-transition message on success, and exit nonzero with actionable diagnostics otherwise.

Add root scripts:

```json
{
  "security:audit:transition": "pnpm audit --audit-level moderate && node ./scripts/check-security-audit-transition.mjs"
}
```

Add the new Node test to the root `test` script's explicit list in lexical order.

- [ ] **Step 6: Run wrapper GREEN and live integration RED**

Run:

```bash
node --test scripts/__tests__/check-security-audit-transition.test.mjs
pnpm security:audit:transition
```

Expected: unit tests still pass; live command fails because the old graph still contains 18 findings. Its failure must identify the unexpected set, not a parser ambiguity.

- [ ] **Step 7: Commit the checker and RED integration contract**

Commit only the new checker, test, and package script registration with message `test: define the dependency audit transition`.

## Task 3: Upgrade jsdom and supported transitives through pnpm

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Verify unchanged at finish: `apps/website/package.json`

- [ ] **Step 1: Record manifest and lock hashes**

Record hashes of root and website manifests and copy the original lockfile to an exact bounded backup path for negative controls. Do not use that backup as a hand-edit source.

- [ ] **Step 2: Run the verified pnpm 10.12.1 lock procedure**

Run exactly, one command at a time:

```bash
pnpm --filter . update --lockfile-only jsdom@30.0.1
pnpm add -Dw --lockfile-only @babel/core@7.29.7 nanoid@3.3.18
pnpm --filter @pretable/app-website add --save-dev --lockfile-only js-yaml@3.15.1
pnpm remove -Dw --lockfile-only @babel/core nanoid
pnpm --filter @pretable/app-website remove --save-dev --lockfile-only js-yaml
pnpm dedupe --lockfile-only
```

Expected final direct dependency diff: only root `jsdom` moves from `^29.1.1` to `^30.0.1`. Root has no direct `@babel/core` or `nanoid`; website has no direct `js-yaml`. If pnpm behaves differently, stop and re-prove a manifest-clean supported procedure—never hand-edit `pnpm-lock.yaml`.

- [ ] **Step 3: Inspect exact patched resolutions**

Use `pnpm why` and lockfile parsing to prove reachable paths resolve:

- jsdom `30.0.1` and its supported patched undici (`>=8.9.0`),
- js-yaml `3.15.1` on gray-matter's 3.x path,
- @babel/core `7.29.7` on the React-hooks/Next path,
- nanoid `3.3.18` on tsup/postcss's 3.x path.

Require the prior vulnerable versions to be absent from the corresponding reachable paths. Do not reject unrelated, safe major lines that are owned by other parents.

- [ ] **Step 4: Install the candidate graph from the lockfile**

Run a normal frozen install after removing only install artifacts owned by this worktree if a clean install is required. Preserve unrelated worktrees and caches. Hash the lock before/after and require no drift.

- [ ] **Step 5: Run the live transition GREEN**

Run:

```bash
pnpm security:audit:transition
```

Expected: `pnpm audit --audit-level moderate` passes and the exact checker confirms only advisory `1120680`, finding version `0.27.7`, at sole path `.>tsup>esbuild`.

- [ ] **Step 6: Run lockfile negative controls**

Use two evidence layers without hand-editing a lockfile:

1. In the pure validator tests, independently add each former undici/jsdom, js-yaml, @babel/core, and nanoid advisory/path to an otherwise exact transition payload and require rejection. Independently mutate the remaining finding's ID, path, version, and severity and require rejection.
2. Create a bounded `git archive` of the recorded pre-PR-2 `origin/main`, frozen-install its committed vulnerable graph, and invoke the candidate checker with that archive as its working directory so its child `pnpm audit --json` observes the real original 18-advisory lockfile. Require integration failure for the unexpected set. Remove only that exact archive after validating its path.

The initial live RED from Task 2 plus this archived-graph control is the end-to-end proof. Do not patch or hand-edit the candidate lockfile for a negative control.

Never commit a control mutation. After every control, run `git hash-object pnpm-lock.yaml` and compare with the intended candidate hash.

- [ ] **Step 7: Commit dependency remediation**

Commit only `package.json` and `pnpm-lock.yaml` with message `chore: update jsdom and patched transitives`.

## Task 4: Diagnose jsdom 30 behavior without weakening tests

**Files:** Focused test/product files only if RED evidence requires them.

- [ ] **Step 1: Run the three jsdom suites before editing tests**

Run React, bench, and website package tests separately and retain output. Compare failures and warning categories with Task 1. Classify each difference as:

- real product defect exposed by jsdom 30,
- test-environment setup incompatible with supported jsdom behavior,
- intentionally changed DOM standard behavior requiring a new expectation, or
- unrelated/flaky/environmental failure that must be independently diagnosed.

- [ ] **Step 2: For each failure, use systematic debugging and a focused RED test**

Add the smallest regression proving the intended browser/product contract before changing implementation or setup. Prioritize selection, focus, pointer/keyboard events, CSS computation, serialization, and SSR/hydration. Do not add version checks, sleeps, longer timeouts, skipped tests, or broad warning suppression.

- [ ] **Step 3: Prove negative controls**

For each behavioral fix, temporarily revert the fix while retaining its regression and require the focused test to fail for the expected reason. Restore and rerun green.

- [ ] **Step 4: Re-run warning classification**

Require no unclassified new category. A removed jsdom warning is acceptable only when the related behavior remains asserted. Record known remaining categories and why they are environment limitations rather than product errors.

- [ ] **Step 5: Commit focused compatibility fixes separately**

Use one commit per coherent behavior, for example `fix(react): preserve focus under jsdom 30`. If all suites pass unchanged, make no compatibility commit and report that result explicitly.

## Task 5: Put the transition gate into CI, deploy, and release

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the workflow contract test and run RED**

Add `scripts/__tests__/security-audit-workflow-contract.test.mjs` and register it in root tests. Discover by parsed text/structured indentation that:

- CI has one job whose effective display context is `security-audit`,
- that job runs the transition command,
- both deploy jobs need it,
- release runs the transition command after install and before the first build/version/publish-capable step, and
- all added setup-node steps retain Node 24.19.0.

Run the focused test before editing workflows. Expected: failure for the missing job, deploy dependencies, and release step—not a parser/load failure.

- [ ] **Step 2: Add the stable CI job**

Add job id `security-audit` with display name exactly `security-audit`. It checks out, sets up pnpm, pins Node 24.19.0, performs a frozen install, and runs:

```bash
pnpm security:audit:transition
```

The job must be independent; do not hide it inside `test` or packaging because branch protection requires its stable context.

- [ ] **Step 3: Gate both deploy jobs**

Add `security-audit` to the existing `needs` lists for `deploy-prod` and `deploy-preview`. Preserve every current need and the deliberate exclusion of dev-smoke and bench-e2e.

- [ ] **Step 4: Gate release before build/version/publish**

Immediately after release's frozen install and before typecheck/build/versioning, add:

```bash
pnpm security:audit:transition
```

Do not use `continue-on-error`, conditional suppression, cached output, or an audit-level-only substitute.

- [ ] **Step 5: Run workflow GREEN and deploy-needs negative control**

Run the focused contract and require GREEN. Then temporarily remove `security-audit` from one deploy `needs`, rerun and require a focused failure naming that job. Restore and rerun GREEN. Also move the release audit below build temporarily and require its ordering assertion to fail; restore.

- [ ] **Step 6: Commit workflow enforcement**

Commit workflow and contract-test changes with message `ci: require dependency audit transition`.

## Task 6: Prove clean installation, scope, and no hidden exceptions

- [ ] **Step 1: Clean-filesystem frozen install**

Archive the repository at `HEAD` into a unique `/tmp` directory, copy no existing `node_modules`, run `pnpm install --frozen-lockfile`, and require the lock hash and tracked files remain unchanged. Alternatively use a fresh worktree on the same commit with an isolated pnpm virtual store. Remove only the exact temporary checkout afterward.

- [ ] **Step 2: Search for prohibited mechanisms**

Run scoped searches across manifests, workspace config, npm config, scripts, and workflows for `overrides`, `patchedDependencies`, `auditConfig`, ignored advisory IDs, `--ignore`, alternate registries, `continue-on-error`, and `1120680`. Expected: the advisory ID appears only in the exact transition checker/tests/docs; no suppression or override exists.

- [ ] **Step 3: Prove exact final manifest scope**

Compare `origin/main...HEAD` manifests. Root changes only jsdom and new scripts/test registration; website manifest is byte-identical; public package manifests are unchanged. `.changeset` has no branch diff.

- [ ] **Step 4: Run all PR 1 package and local browser gates**

Repeat the packed-package ESM/CJS smoke, local production website Chromium and WebKit with explicit `BASE_URL` and `--retries=0`, and full local bench Chromium with one worker and `--retries=0`. Preserve and restore ignored artifact baselines and stop tracked servers exactly as described in the PR 1 plan.

## Task 7: Full independent gate and review

- [ ] **Step 1: Require final upstream ancestry and clean state**

Fetch, require `origin/main` ancestor/behind 0, and restart this task if upstream integration is authorized.

- [ ] **Step 2: Run every command independently**

```bash
pnpm install --frozen-lockfile
pnpm security:audit:transition
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
pnpm exec changeset status
```

Expected: all exit 0; audit confirms exactly one finding; no branch-owned Changeset. Classify warnings against the captured baseline.

- [ ] **Step 3: Perform complete self-review**

Audit dependency diffs, all changed assertions, warning changes, workflow order, deploy needs, public manifest immutability, audit fail-closed behavior, and control residue. Request independent spec and quality reviews and resolve every Important-or-higher finding.

## Task 8: PR, branch protection, merge, and post-merge evidence

- [ ] **Step 1: Push normally and open the PR**

PR text must state the exact old/new audit sets, dependency paths, jsdom behavior findings, absence of overrides/ignores, stable job name, release/deploy gating, no Changeset, and complete local evidence. Remove agent references.

- [ ] **Step 2: Wait for the PR's `security-audit` context to complete green**

Do not mutate branch protection before GitHub has created the context on the PR. Require all other review/check gates green as well.

- [ ] **Step 3: Snapshot classic branch protection**

The repository currently has no rulesets and uses classic protection. Re-read both endpoints rather than assuming that remains true:

```bash
gh api repos/cacheplane/pretable/rulesets --paginate
gh api repos/cacheplane/pretable/branches/main/protection > <bounded-temp>/protection.before.json
```

At planning time the required contexts are `test`, `typecheck`, `lint`, `format`, `build`, `Packaging — publint + attw`, `API Extractor — report freshness`, and `Smoke test → Vercel preview (Playwright)`. Treat the live snapshot as authority; preserve any contexts/settings added since planning.

- [ ] **Step 4: Add only the new required context**

If `security-audit` is not already present, call only the narrow endpoint:

```bash
printf '%s\n' '{"contexts":["security-audit"]}' > <bounded-temp>/add-security-audit.json
gh api --method POST \
  repos/cacheplane/pretable/branches/main/protection/required_status_checks/contexts \
  --input <bounded-temp>/add-security-audit.json
```

Do not PUT the whole protection document. If credentials cannot read and update protection, stop and block merge.

- [ ] **Step 5: Read back and compare protection**

Fetch `protection.after.json` and a second `protection.after-confirm.json`. Build deterministic normalized evidence:

```bash
gh api repos/cacheplane/pretable/branches/main/protection > <bounded-temp>/protection.after.json
gh api repos/cacheplane/pretable/branches/main/protection > <bounded-temp>/protection.after-confirm.json
jq -S '.required_status_checks.contexts | sort' <bounded-temp>/protection.before.json > <bounded-temp>/contexts.before.json
jq -S '.required_status_checks.contexts | sort' <bounded-temp>/protection.after.json > <bounded-temp>/contexts.after.json
jq -S '.required_status_checks.checks | sort_by(.context, .app_id)' <bounded-temp>/protection.before.json > <bounded-temp>/checks.before.json
jq -S '[.required_status_checks.checks[] | select(.context != "security-audit")] | sort_by(.context, .app_id)' <bounded-temp>/protection.after.json > <bounded-temp>/checks.after-without-security.json
jq -S 'del(.required_status_checks.contexts, .required_status_checks.checks)' <bounded-temp>/protection.before.json > <bounded-temp>/settings.before.json
jq -S 'del(.required_status_checks.contexts, .required_status_checks.checks)' <bounded-temp>/protection.after.json > <bounded-temp>/settings.after.json
jq -S . <bounded-temp>/protection.after.json > <bounded-temp>/after.normalized.json
jq -S . <bounded-temp>/protection.after-confirm.json > <bounded-temp>/after-confirm.normalized.json
jq -S '. + ["security-audit"] | unique | sort' <bounded-temp>/contexts.before.json > <bounded-temp>/contexts.expected.json
cmp <bounded-temp>/contexts.expected.json <bounded-temp>/contexts.after.json
cmp <bounded-temp>/checks.before.json <bounded-temp>/checks.after-without-security.json
cmp <bounded-temp>/settings.before.json <bounded-temp>/settings.after.json
cmp <bounded-temp>/after.normalized.json <bounded-temp>/after-confirm.normalized.json
```

Use a small `jq` assertion to require the after context set equals the before set plus `security-audit`, then use `cmp` for the normalized non-context settings and second read. Assert that:

- the context set equals the complete before set plus exactly `security-audit`,
- every pre-existing required-check object, including its `app_id` binding, is deeply equal before/after,
- every non-context/check protection field is deeply equal before/after,
- `allow_force_pushes`, `allow_deletions`, and all other live protections did not weaken, and
- a second read produces the same document.

Retain the before/after JSON only in the bounded local evidence directory; do not commit repository administration output.

- [ ] **Step 6: Merge only on terminal green**

Obtain independent approval, then enable guarded squash auto-merge. Verify the merge commit tree matches the reviewed PR head.

- [ ] **Step 7: Monitor same-commit post-merge automation**

Require CI, release, CodeQL, OpenSSF, production deployment, and production Playwright smoke success. Verify release runs the transition gate before any release action, publishes nothing, and creates no unexpected version PR.

- [ ] **Step 8: Record the merge SHA for PR 3**

Verify main contains the merge, branch protection still requires all prior contexts plus `security-audit`, and the worktree is clean. Hand off the exact merge SHA and exact live advisory payload.
