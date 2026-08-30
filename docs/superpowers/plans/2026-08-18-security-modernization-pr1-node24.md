# Security Modernization PR 1: Node 24 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Node.js 24.19.0 the reproducible contributor and automation toolchain without changing published-package runtime metadata or behavior.

**Architecture:** A self-discovering repository contract test owns the version-manager file, root engine range, active workflow pins, and current contributor docs. All active `actions/setup-node` steps use one exact LTS patch while package runtime compatibility remains untouched.

**Tech Stack:** Node.js 24.19.0, pnpm 10.12.1, Node test runner, GitHub Actions, Playwright, pnpm pack.

---

## File map

| File | Responsibility |
| --- | --- |
| `.node-version` | Exact contributor/tool-manager Node version: `24.19.0`. |
| `package.json` | Root engine `^24.15.0`; register the toolchain contract test in the explicit root test list. |
| `scripts/__tests__/node-toolchain-contract.test.mjs` | Discover and enforce every active workflow pin plus root/docs metadata. |
| `.github/workflows/ci.yml` | Pin all 16 CI setup-node steps to `24.19.0`. |
| `.github/workflows/release.yml` | Replace floating release Node 24 with `24.19.0`. |
| `.github/workflows/prod-freshness.yml` | Pin the scheduled/on-demand freshness job to `24.19.0`. |
| `README.md` | Current contributor requirement: Node 24 and pnpm 10. |
| `CONTRIBUTING.md` | Current contributor requirement: Node 24 and pnpm 10. |

Historical plans/specifications are evidence, not active toolchain instructions; do not rewrite them. No Changeset is required because no publishable package manifest or runtime contract changes.

## Task 1: Synchronize and prove the baseline

**Files:** Verify only.

- [ ] **Step 1: Enter an isolated worktree and synchronize**

Run:

```bash
git status --short --branch
git fetch --prune origin
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean worktree, `origin/main` is an ancestor, and the branch is behind 0. If this plan itself is not yet on `main`, create the implementation branch from the reviewed planning commit and record that relationship explicitly; do not drop the approved design or plans.

- [ ] **Step 2: Require the exact Node runtime before dependency work**

Run:

```bash
node --version
pnpm --version
```

Expected: `v24.19.0` and `10.12.1`. If the shell is not using Node 24.19.0, switch with the contributor's version manager before continuing. Do not run the verification matrix under Node 22 and call the pin complete.

- [ ] **Step 3: Record the untouched workflow and documentation baseline**

Run:

```bash
rg -n 'node-version:' .github/workflows -g '*.yml'
rg -n 'Node(.js)? 22\+|Node(.js)? 24' README.md CONTRIBUTING.md
test ! -e .node-version
```

Expected at the approved baseline: 18 workflow `node-version` occurrences (17 floating `22`, one floating `24`), two active Node 22+ documentation lines, and no `.node-version`.

- [ ] **Step 4: Install from the committed lockfile without drift**

Run:

```bash
before=$(git hash-object pnpm-lock.yaml)
pnpm install --frozen-lockfile
after=$(git hash-object pnpm-lock.yaml)
test "$before" = "$after"
git status --short
```

Expected: install succeeds, hashes match, and status stays clean.

## Task 2: Add the self-discovering toolchain contract test

**Files:**

- Create: `scripts/__tests__/node-toolchain-contract.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing contract test**

Add `yaml` as a declared root development dependency and create a Node test that:

1. reads `package.json` and asserts `engines.node === "^24.15.0"` and `packageManager === "pnpm@10.12.1"`,
2. reads `.node-version` and asserts its trimmed content is `24.19.0`,
3. discovers every `.yml` and `.yaml` file under `.github/workflows`,
4. discovers every `uses: actions/setup-node@...` step under `jobs.<job>.steps`, including recursively nested `parallel` step groups and repeated YAML aliases, rather than relying on job names or a hard-coded count,
5. requires every discovered setup-node step to contain `node-version: 24.19.0`,
6. requires every `node-version:` key anywhere in those active workflows to equal `24.19.0` so a stray non-setup pin cannot drift silently,
7. fails closed with file and line context for invalid YAML or an unresolved YAML alias,
8. asserts at least one setup-node step was found, and
9. asserts `README.md` and `CONTRIBUTING.md` contain the current Node 24/pnpm 10 instruction and contain no active `Node.js 22+` instruction.

Parse workflows with the declared YAML parser rather than a partial handwritten lexer. Use repository-relative paths derived from `import.meta.url`, not `process.cwd()` assumptions. Emit file and line context for every mismatch so a workflow addition is easy to repair.

Add this file to the root `test` script's explicit `node --test` list in lexical order.

- [ ] **Step 2: Run the RED test**

Run:

```bash
node --test scripts/__tests__/node-toolchain-contract.test.mjs
```

Expected: failure for the absent `.node-version`, old engine, workflow pins, and docs. The test must not pass merely because it found zero workflow steps.

- [ ] **Step 3: Commit the test-only RED state**

Run:

```bash
git add package.json pnpm-lock.yaml scripts/__tests__/node-toolchain-contract.test.mjs
git diff --cached --check
git commit -m "test: pin the repository Node toolchain"
```

Include `pnpm-lock.yaml` in the staged paths after pnpm records the declared `yaml` development dependency. Expected: commit contains only the root test registration, declared parser dependency and lockfile importer entry, and new test.

## Task 3: Pin Node 24.19.0 everywhere active

**Files:**

- Create: `.node-version`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/prod-freshness.yml`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Apply the minimal metadata and workflow changes**

Set:

```text
.node-version: 24.19.0
package.json engines.node: ^24.15.0
every active workflow node-version: 24.19.0
README/CONTRIBUTING: Use Node.js 24 and pnpm 10+
```

Do not add `engines.node` to `packages/*/package.json`; the build machine is not the package runtime floor. Keep `pnpm@10.12.1` unchanged.

- [ ] **Step 2: Run the focused GREEN test**

Run:

```bash
node --test scripts/__tests__/node-toolchain-contract.test.mjs
```

Expected: pass.

- [ ] **Step 3: Run a discovery negative control**

Temporarily change one otherwise unremarkable setup-node step (for example `examples-registry`) back to `22`, run the focused test, and require it to fail while naming that workflow occurrence. Restore the intended pin and rerun to green.

Do not commit the control mutation.

- [ ] **Step 4: Prove the complete occurrence set**

Run:

```bash
rg -n 'uses: actions/setup-node@|node-version:' .github/workflows -g '*.yml' -g '*.yaml'
rg -n 'node-version: (22|24)$' .github/workflows -g '*.yml' -g '*.yaml' && exit 1 || true
rg -n 'Node(.js)? 22\+' README.md CONTRIBUTING.md && exit 1 || true
```

Expected: every setup-node step is followed by the exact patch pin, and the two residue searches return no matches. Review the full output; do not assert only an old count because workflows can be added.

- [ ] **Step 5: Commit the implementation**

Run:

```bash
git add .node-version package.json README.md CONTRIBUTING.md .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/prod-freshness.yml
git diff --cached --check
git commit -m "chore: standardize on Node 24"
```

Expected: only the approved toolchain files are committed.

## Task 4: Verify packed packages remain behaviorally unchanged

**Files:** Verify only.

- [ ] **Step 1: Build all four public packages**

Run:

```bash
pnpm -r --filter '@pretable/core...' --filter '@pretable/react...' --filter '@pretable/stream-adapter...' --filter '@pretable/ui...' build
```

Expected: exit 0 under Node 24.19.0.

- [ ] **Step 2: Pack into a fresh bounded directory**

Create a unique directory with `mktemp -d`, then run `pnpm --filter <package> pack --pack-destination <literal-temp-dir>` for core, react, stream-adapter, and UI. Inspect each tarball with `tar -tf`; require manifests, README/license where currently shipped, `dist` ESM/CJS/declarations, and UI CSS assets. Reject workspace source, private package files, private package runtime imports or runtime dependencies, declaration files (`.d.ts`/`.d.cts`) that import or type-reference private `@pretable-internal` packages, tests/configs/node_modules, and workspace protocols. Exempt only verified unchanged declaration-comment prose, LICENSE legal/acknowledgement prose containing `@pretable-internal` names, and pnpm-rewritten private devDependencies as baseline metadata, not runtime leakage.

- [ ] **Step 3: Exercise registry-shaped ESM and CommonJS imports**

In a child directory of that exact temp root, create a minimal private package and install the four tarballs plus the repository's current React/ReactDOM 19 versions using npm with scripts disabled. Require install exit 0 and no peer warnings. Run one ESM program and one CommonJS program that import/require all four public package names and assert representative exports are defined.

This is a regression smoke only; PR 3 adds the permanent comprehensive packed-consumer matrix.

- [ ] **Step 4: Clean only the exact temporary directory**

Remove the exact `mktemp` directory after asserting it is non-empty, under the system temporary root, and contains the expected tarballs. Verify it no longer exists. Do not use a workspace root or unresolved variable as a deletion target.

## Task 5: Run local candidate browser gates

**Files:** Verify only.

- [ ] **Step 1: Preserve ignored browser/build artifacts**

Record `git status --short`, move any pre-existing `.next`, `dist`, `test-results`, and Playwright report directories plus ignored `*.tsbuildinfo` files into one unique bounded backup directory, and record exactly what moved. The incremental build metadata must move with `dist`: otherwise `tsc -b` can treat a package as up to date after its declared outputs were moved, leaving downstream package builds unable to resolve the missing files. Restore every recorded artifact after the gates. Never delete a pre-existing artifact to make the worktree look clean.

- [ ] **Step 2: Build and start the website candidate on a checked-free port**

Choose a literal high port, require `lsof` shows no listener, run the website production build to terminal exit 0, assert `apps/website/.next/BUILD_ID` exists, and start `next start --hostname 127.0.0.1 --port <port>` as a tracked long-running process. Wait until `curl --fail` returns 200.

- [ ] **Step 3: Run website Chromium and WebKit separately with no retries**

Run each project independently:

```bash
env -u NO_COLOR BASE_URL=http://127.0.0.1:<port> pnpm --filter @pretable/app-website smoke --project=chromium --retries=0
env -u NO_COLOR BASE_URL=http://127.0.0.1:<port> pnpm --filter @pretable/app-website smoke --project=webkit --retries=0
```

Expected: both initial runs pass with zero retries against the local candidate, not deployed `main`.

- [ ] **Step 4: Stop and verify exact website server cleanup**

Stop the tracked server, observe terminal exit, require no listener and a failing curl on the exact port, then classify server warnings.

- [ ] **Step 5: Build and start the bench candidate**

Build `@pretable/app-bench` and require both `apps/bench/dist/index.html` and the nonempty `apps/bench/dist/bench-build-id.txt` emitted by `apps/bench/vite.config.ts`. Choose a second checked-free literal port and start `vite preview --host 127.0.0.1 --port <port> --strictPort` as a tracked process. Wait for HTTP 200, fetch `/bench-build-id.txt`, and require it equals the local file before running Playwright. This is the same freshness contract enforced by `apps/bench/tests/bench.spec.ts`.

- [ ] **Step 6: Run the complete bench Chromium suite with no retries**

Run:

```bash
env -u NO_COLOR PRETABLE_BENCH_EXTERNAL_SERVER=1 PRETABLE_BENCH_BASE_URL=http://127.0.0.1:<port> pnpm bench:e2e -- --project=chromium --workers=1 --retries=0
```

Expected: complete suite passes on its first run. Do not set adapter/scenario/scale/script selectors because those can skip memory coverage.

- [ ] **Step 7: Stop bench and restore the artifact baseline**

Stop the tracked process, verify the port is closed, move fresh artifacts (including fresh `*.tsbuildinfo`) aside, restore each recorded pre-existing artifact byte-for-byte, remove only the bounded fresh/backup directories, and prove tracked status matches the pre-gate baseline.

## Task 6: Full independent gate and review

**Files:** Verify only.

- [ ] **Step 1: Fetch and require final ancestry before the gate**

Run:

```bash
git fetch --prune origin
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
git status --short
```

Expected: ancestor exit 0, behind 0, clean. If upstream moved, inspect and integrate only with authorization, then restart Tasks 4–6 on the final graph.

- [ ] **Step 2: Run every independent repository gate**

Run each command separately and stop at the first failure:

```bash
pnpm install --frozen-lockfile
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
```

Expected: all exit 0. Classify only pre-existing warnings; no new warning is accepted silently.

- [ ] **Step 3: Prove no release note is warranted**

Run:

```bash
git diff --name-only origin/main...HEAD -- .changeset packages/*/package.json packages/*/src
pnpm exec changeset status
```

Expected: no Changeset or publishable package/runtime source diff from this PR; plain status may show unrelated upstream release intent but no branch-owned release note.

- [ ] **Step 4: Perform scoped self-review and independent reviews**

Review the entire range for accidental published-package engine changes, floating workflow versions, a missed setup-node step, changes outside active docs, and stale Node 22 guidance. Request independent spec-compliance and code-quality review; resolve every Important-or-higher finding and re-run affected gates.

- [ ] **Step 5: Create the final commit if review changed files**

Use a focused message such as `fix: close Node 24 review gaps`; do not amend reviewed commits after final evidence without rerunning the affected verification.

## Task 7: Pull request, merge, and post-merge verification

- [ ] **Step 1: Push normally and open a focused PR**

Confirm the branch contains no references to agent names in commits or PR text. Push without force, create the PR, and state explicitly: exact Node pin, root engine floor, active workflow coverage, no published package engine change, no Changeset, and full local evidence.

- [ ] **Step 2: Merge only after every required check is terminal green**

Enable squash auto-merge only after review is approved and the complete check set exists. Do not treat skipped required coverage or a superseded run as green evidence.

- [ ] **Step 3: Monitor post-merge automation**

Require same-commit CI, release, CodeQL, OpenSSF, production deployment, and production Playwright smoke to finish successfully. Release should find no branch-owned Changeset and publish nothing.

- [ ] **Step 4: Record the PR 1 merge SHA for PR 2**

Verify `origin/main` points at or contains the squash merge, the working tree is clean, and save the merge SHA in the handoff. PR 2 must begin by proving that SHA is an ancestor.
