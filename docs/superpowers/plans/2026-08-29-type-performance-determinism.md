# Deterministic Type-Performance Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TypeScript heap-budget measurements deterministic by exposing garbage collection to the exact installed compiler, and enforce the repaired gate in the existing required CI typecheck job.

**Architecture:** `scripts/check-type-performance.mjs` remains the sole runner and continues to launch the workspace-resolved TypeScript CLI directly through `process.execPath`. Add `--expose-gc` as the first Node argument so TypeScript 6.0.3 collects immediately before reading `heapUsed`; preserve every fixture, parser, budget, and summary. Add the existing `pnpm typecheck:performance` command to the already-required CI `typecheck` job instead of introducing a new status context.

**Tech Stack:** Node.js 22.14.0 and 24.19.0, TypeScript 6.0.3 extended diagnostics, Node's built-in test runner, pnpm 10.12.1, GitHub Actions YAML.

---

## Scope and file ownership

The implementation owns exactly these files:

- `scripts/check-type-performance.mjs` — constructs and runs the exact TypeScript child process.
- `scripts/__tests__/check-type-performance.test.mjs` — pins the invocation contract and CI placement.
- `.github/workflows/ci.yml` — runs the repaired performance gate in the existing required `typecheck` job.
- `docs/superpowers/specs/2026-08-24-type-performance-determinism-design.md` — approved architecture and refreshed evidence; do not change unless review finds a factual error.
- `docs/superpowers/plans/2026-08-29-type-performance-determinism.md` — this implementation and verification contract.

Do not change `type-tests/performance/budgets.json`, TypeScript or Node versions, product/package source, manifests, the lockfile, Changesets configuration, or branch protection.

## Required working rules

- Use @superpowers:test-driven-development for Tasks 2 and 3.
- Use @superpowers:systematic-debugging for any unexpected failure; never rerun a failed memory sample in the same attempt, and investigate it before authorizing a fresh attempt.
- Use @superpowers:verification-before-completion before commits, the PR, or any success claim.
- Keep Node 22.14.0 as the branch's declared baseline. Use explicit absolute Node-bin prefixes for the Node 22/24 acceptance matrix.
- Never add `--expose-gc` to `NODE_OPTIONS`; launch the compiler child with an explicit argument.
- Never raise or recalibrate a budget in this PR.
- Do not add a Changeset. This is internal test/CI infrastructure with no package or public API change.

### Execution precondition: commit this reviewed plan

Do not begin Task 1 while this plan is untracked or modified. After plan review is
approved, run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-08-29-type-performance-determinism.md
pnpm exec prettier --check docs/superpowers/plans/2026-08-29-type-performance-determinism.md
git diff --check
git add docs/superpowers/plans/2026-08-29-type-performance-determinism.md
git diff --cached --check
git diff --cached -- docs/superpowers/plans/2026-08-29-type-performance-determinism.md
git commit -m "docs: plan deterministic type performance checks"
git status --porcelain=v1 --untracked-files=all
```

Expected: the plan is the only committed path and the final status is empty.

### Acceptance-attempt lifecycle

Each complete Tasks 1–5 attempt owns exactly one canonical bounded evidence
directory. Never overwrite a file, reuse a failed directory, or create a second
active acceptance directory. The planned Task 2/3 RED and negative-control
nonzero exits are not attempt failures only when the commands mechanically prove
their exact expected single-failure contracts. On any unexpected failure,
acceptance/gate failure, review-invalidating edit, or base drift:

1. Stop immediately and preserve the failed attempt unchanged while applying
   @superpowers:systematic-debugging.
2. Record the root cause and the decision authorizing a fresh full attempt.
3. Remove only the failed attempt's validated canonical literal directory with
   the same `realpath`, bounded-prefix, `find <literal> -depth -delete` guard used
   in Task 6.
4. Restart at Task 1 and create one new canonical evidence directory. Previous
   samples or gates never count toward the new attempt.

Thus only one acceptance directory is active at a time, and every successful
acceptance record is one uninterrupted, no-overwrite attempt.

Under `set -C`, direct redirects exclusively create a new log (`command > new-file`);
pre-created logs must use append-through-tee (`: > new-file; command | tee -a new-file`).
Expected-failure logs require `test ! -e "$log"` before `set +e`.

### Task 1: Reconfirm the latest-main baseline and establish evidence hygiene

**Files:**

- Verify only; no tracked edits.

- [ ] **Step 1: Fetch and record branch state**

Run from `/Users/blove/repos/pretable/.worktrees/type-performance-determinism`:

```bash
git fetch --prune origin
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
git rev-parse origin/main
git merge-base origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
git diff --check
shasum -a 256 pnpm-lock.yaml
```

Expected: clean status; `origin/main` is the merge base; `0` behind; lock SHA-256 `30df6f0e9865c1cbdcb98c72e362de75cc8d7f8ecb119e2484e9a063f036abcb` unless main has intentionally changed the lock after another authorized rebase.

- [ ] **Step 2: Create this attempt's one bounded evidence directory**

```bash
set -euo pipefail
set -C
evidence_dir=$(mktemp -d /tmp/pretable-typeperf-acceptance.XXXXXX)
test -d "$evidence_dir"
evidence_dir=$(realpath "$evidence_dir")
case "$evidence_dir" in
  /tmp/pretable-typeperf-acceptance.*|/private/tmp/pretable-typeperf-acceptance.*) ;;
  *) exit 1 ;;
esac
printf '%s\n' "$evidence_dir"
```

Copy the printed absolute path into the execution record. Substitute that exact
literal path for every `<EVIDENCE_DIR>` below; do not carry an unresolved shell
variable between tasks and do not create a second evidence directory during
this attempt.

- [ ] **Step 3: Capture ignored-artifact, process, warning, and packaging-advisory baselines**

```bash
set -euo pipefail
set -C
git status --ignored --porcelain=v1 --untracked-files=all > <EVIDENCE_DIR>/ignored-status-baseline.txt
ps -axo pid,ppid,stat,etime,command > <EVIDENCE_DIR>/process-baseline.txt
: > <EVIDENCE_DIR>/baseline-install.log
pnpm install --frozen-lockfile 2>&1 | tee -a <EVIDENCE_DIR>/baseline-install.log
: > <EVIDENCE_DIR>/baseline-test.log
pnpm test 2>&1 | tee -a <EVIDENCE_DIR>/baseline-test.log
: > <EVIDENCE_DIR>/baseline-build.log
pnpm build 2>&1 | tee -a <EVIDENCE_DIR>/baseline-build.log
: > <EVIDENCE_DIR>/baseline-lint.log
pnpm lint 2>&1 | tee -a <EVIDENCE_DIR>/baseline-lint.log
: > <EVIDENCE_DIR>/baseline-lint-packaging.log
pnpm lint:packaging 2>&1 | tee -a <EVIDENCE_DIR>/baseline-lint-packaging.log
: > <EVIDENCE_DIR>/baseline-api-check.log
pnpm api:check 2>&1 | tee -a <EVIDENCE_DIR>/baseline-api-check.log
rg -n -i 'ignored build scripts.*esbuild|configLoader.*native|__dirname.*import\.meta\.dirname|not implemented.*HTMLCanvasElement|not implemented.*navigation|some chunks are larger than [0-9]+ kB after minification|dynamic filesystem access causes tracing of the whole project|Compilation Skipped: Use of incompatible library|newer than the bundled compiler engine; consider upgrading API Extractor' \
  <EVIDENCE_DIR>/baseline-*.log > <EVIDENCE_DIR>/warning-baseline.txt || test $? -eq 1
git status --ignored --porcelain=v1 --untracked-files=all > <EVIDENCE_DIR>/ignored-status-after-baseline.txt
diff -u <EVIDENCE_DIR>/ignored-status-baseline.txt <EVIDENCE_DIR>/ignored-status-after-baseline.txt || test $? -eq 1
```

Expected: every install, test, build, lint, packaging-lint, and API-check command
exits 0. Record and explain any ignored-path delta produced by the baseline
itself. Record the eight existing warning classes: pnpm's ignored `esbuild`
build-script notice, Vite native-config `__dirname`, jsdom canvas/navigation
limitations, Vite's upstream-owned large-chunk advisory, Next/Turbopack's
upstream-owned dynamic-filesystem tracing advisory, ESLint's React Compiler
incompatible-library warning, and API Extractor's bundled-TypeScript-version
advisory. Record publint `Suggestions:` separately in the packaging-advisory
baseline; they are structured advisories, not a ninth warning class. Investigate
any other warning or packaging advisory before accepting it.
`set -C` plus the fresh directory makes every evidence path exclusive; an
attempted retry must fail instead of overwriting the first observation.

- [ ] **Step 4: Verify the frozen graph and focused baseline**

```bash
set -euo pipefail
set -C
: > <EVIDENCE_DIR>/lock-baseline.txt
shasum -a 256 pnpm-lock.yaml | tee -a <EVIDENCE_DIR>/lock-baseline.txt
: > <EVIDENCE_DIR>/focused-baseline.log
node --test scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/focused-baseline.log
git status --porcelain=v1 --untracked-files=all
git diff --check
```

Expected: lock hash is unchanged, repository status is empty, and all current
focused tests pass before the contract change.

### Task 2: Make the compiler invocation deterministic

**Files:**

- Modify: the invocation-contract test in `scripts/__tests__/check-type-performance.test.mjs`
- Modify: `createTypeScriptInvocation` in `scripts/check-type-performance.mjs`

- [ ] **Step 1: Update the invocation test first**

Rename the test to describe the complete contract and change its expected arguments to:

```js
test("invokes the installed TypeScript CLI through GC-enabled Node", async () => {
  const configPath = "/tmp/config with spaces; $(not-a-shell).json";
  const invocation = createTypeScriptInvocation(configPath);
  const typescriptDirectory = path.dirname(
    require.resolve("typescript/package.json"),
  );
  const cliPath = invocation.args[1];

  assert.equal(invocation.executable, process.execPath);
  assert.equal(path.isAbsolute(cliPath), true);
  await access(cliPath);
  const relativeCliPath = path.relative(typescriptDirectory, cliPath);
  assert.equal(path.isAbsolute(relativeCliPath), false);
  assert.doesNotMatch(relativeCliPath, /^\.\.(?:[/\\]|$)/);
  assert.deepEqual(invocation.args, [
    "--expose-gc",
    cliPath,
    "-p",
    configPath,
    "--noEmit",
    "--extendedDiagnostics",
    "--pretty",
    "false",
  ]);
  assert.equal(invocation.shell, undefined);
  assert.equal(
    invocation.args.some((argument) => /^(?:pnpm|pnpm\.cmd)$/i.test(argument)),
    false,
  );
});
```

- [ ] **Step 2: Run the test and prove RED**

```bash
set -euo pipefail
set -C
log=<EVIDENCE_DIR>/task2-red.log
test ! -e "$log"
set +e
node --test --test-name-pattern="GC-enabled Node" scripts/__tests__/check-type-performance.test.mjs > "$log" 2>&1
test_exit=$?
set -e
test "$test_exit" -eq 1
test "$(rg -c '^not ok ' "$log")" -eq 1
rg -n '^not ok .*GC-enabled Node' "$log"
```

Expected: exactly the invocation-contract test fails because the current first argument is the TypeScript CLI path instead of `--expose-gc`. Parser, budget, and fixture tests are not selected or do not fail.

- [ ] **Step 3: Add the minimal runner change**

Change only `createTypeScriptInvocation`:

```js
export function createTypeScriptInvocation(configPath) {
  return {
    args: [
      "--expose-gc",
      typescriptCliPath,
      "-p",
      configPath,
      "--noEmit",
      "--extendedDiagnostics",
      "--pretty",
      "false",
    ],
    executable: process.execPath,
  };
}
```

Do not change `runTypeScript`, parser behavior, budgets, fixture order, the compiler resolver, or error propagation.

- [ ] **Step 4: Run the focused test and prove GREEN**

```bash
set -euo pipefail
set -C
: > <EVIDENCE_DIR>/task2-green-focused.log
node --test --test-name-pattern="GC-enabled Node" scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task2-green-focused.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task2-green-focused.log
: > <EVIDENCE_DIR>/task2-green-complete.log
node --test scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task2-green-complete.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task2-green-complete.log
```

Expected: focused contract passes; complete file passes with no changed summary or validation behavior.

- [ ] **Step 5: Run the required negative control**

Temporarily remove only the `"--expose-gc"` argument with `apply_patch`, then run:

```bash
set -euo pipefail
set -C
log=<EVIDENCE_DIR>/task2-negative.log
test ! -e "$log"
set +e
node --test scripts/__tests__/check-type-performance.test.mjs > "$log" 2>&1
test_exit=$?
set -e
test "$test_exit" -eq 1
test "$(rg -c '^not ok ' "$log")" -eq 1
rg -n '^not ok .*GC-enabled Node' "$log"
```

Expected: exactly one failure in `invokes the installed TypeScript CLI through GC-enabled Node`; all other tests pass. Restore the argument with `apply_patch`, rerun the file, and require full green. Confirm no negative-control residue:

```bash
set -euo pipefail
set -C
: > <EVIDENCE_DIR>/task2-restored.log
node --test scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task2-restored.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task2-restored.log
git diff --check
rg -n 'expose-gc' scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs
```

Expected: one production occurrence and one test expectation occurrence, with no temporary comments or alternate flag.

- [ ] **Step 6: Review and commit the runner repair**

```bash
pnpm exec prettier --check scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs
git diff --check
git diff -- scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs
git add scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs
git diff --cached --check
git commit -m "fix: make type performance memory deterministic"
```

Expected: commit contains only the invocation test and the one-argument runner change.

### Task 3: Enforce the repaired gate in required CI

**Files:**

- Modify: the `node:fs/promises` import and CI-contract test area in `scripts/__tests__/check-type-performance.test.mjs`
- Modify: the `typecheck` job in `.github/workflows/ci.yml`

- [ ] **Step 1: Add a small workflow-job extractor in the test file**

Extend the existing `node:fs/promises` import to include `readFile`. Add this test-only helper near the imports:

```js
const ciWorkflowPath = new URL("../../.github/workflows/ci.yml", import.meta.url);

function readWorkflowJob(workflow, jobName) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing ${jobName} workflow job`);
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^  [A-Za-z0-9_-]+:$/.test(line));
  const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start, end).join("\n");
}
```

This parser is deliberately narrow: it recognizes top-level two-space job keys and does not attempt to parse arbitrary YAML.

- [ ] **Step 2: Add the CI contract test**

```js
test("required typecheck CI runs the performance gate after ordinary typecheck", async () => {
  const workflow = await readFile(ciWorkflowPath, "utf8");
  const job = readWorkflowJob(workflow, "typecheck");
  const typecheckStep = "      - run: pnpm typecheck";
  const performanceStep = "      - run: pnpm typecheck:performance";
  const lines = job.split("\n");

  assert.equal(lines.filter((line) => line === typecheckStep).length, 1);
  assert.equal(lines.filter((line) => line === performanceStep).length, 1);
  assert.ok(lines.indexOf(performanceStep) > lines.indexOf(typecheckStep));
});
```

- [ ] **Step 3: Run the CI contract and prove RED**

```bash
set -euo pipefail
set -C
log=<EVIDENCE_DIR>/task3-red.log
test ! -e "$log"
set +e
node --test --test-name-pattern="required typecheck CI" scripts/__tests__/check-type-performance.test.mjs > "$log" 2>&1
test_exit=$?
set -e
test "$test_exit" -eq 1
test "$(rg -c '^not ok ' "$log")" -eq 1
rg -n '^not ok .*required typecheck CI' "$log"
```

Expected: failure because the `typecheck` job does not yet contain `pnpm typecheck:performance`.

- [ ] **Step 4: Add the performance step to the existing job**

Modify only the `typecheck` job:

```yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm typecheck:performance
```

Do not create a new job or context. Do not edit deploy `needs`, branch protection, other Node pins, or checkout depth.

- [ ] **Step 5: Run the focused and complete Node tests**

```bash
set -euo pipefail
set -C
: > <EVIDENCE_DIR>/task3-green-focused.log
node --test --test-name-pattern="required typecheck CI" scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task3-green-focused.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task3-green-focused.log
: > <EVIDENCE_DIR>/task3-green-complete.log
node --test scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task3-green-complete.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task3-green-complete.log
```

Expected: focused and complete files pass.

- [ ] **Step 6: Run the CI negative control**

Temporarily remove only the new workflow line with `apply_patch`, then run:

```bash
set -euo pipefail
set -C
log=<EVIDENCE_DIR>/task3-negative.log
test ! -e "$log"
set +e
node --test scripts/__tests__/check-type-performance.test.mjs > "$log" 2>&1
test_exit=$?
set -e
test "$test_exit" -eq 1
test "$(rg -c '^not ok ' "$log")" -eq 1
rg -n '^not ok .*required typecheck CI' "$log"
```

Restore the workflow line with `apply_patch`, then require a preserved full-green
result:

```bash
set -euo pipefail
set -C
: > <EVIDENCE_DIR>/task3-restored.log
node --test scripts/__tests__/check-type-performance.test.mjs 2>&1 | tee -a <EVIDENCE_DIR>/task3-restored.log
! rg -n '^not ok ' <EVIDENCE_DIR>/task3-restored.log
```

- [ ] **Step 7: Review and commit CI enforcement**

```bash
pnpm exec prettier --check .github/workflows/ci.yml scripts/__tests__/check-type-performance.test.mjs
git diff --check
git diff -- .github/workflows/ci.yml scripts/__tests__/check-type-performance.test.mjs
git add .github/workflows/ci.yml scripts/__tests__/check-type-performance.test.mjs
git diff --cached --check
git commit -m "ci: enforce type performance budgets"
```

Expected: commit contains only the existing required job's new step and its contract test.

### Task 4: Prove real-compiler stability on Node 22 and Node 24

**Files:**

- Verify only; no tracked edits.

- [ ] **Step 1: Establish a quiescent measurement environment**

Using the literal Task 1 evidence path, run:

```bash
set -euo pipefail
set -C
date -u +%Y-%m-%dT%H:%M:%SZ > <EVIDENCE_DIR>/measurement-time.txt
uname -a > <EVIDENCE_DIR>/measurement-uname.txt
sysctl -n hw.ncpu > <EVIDENCE_DIR>/measurement-cpus.txt
uptime > <EVIDENCE_DIR>/measurement-uptime.txt
ps -axo pid,ppid,stat,etime,command > <EVIDENCE_DIR>/process-before-matrix.txt
```

Wait until no process from this worktree is running `pnpm test`, `vitest`,
`tsc`, `check-type-performance`, a build, Playwright, Next, or Vite. Do not
terminate unrelated processes.

- [ ] **Step 2: Pin and record all runtime versions**

```bash
set -euo pipefail
set -C
PATH=/Users/blove/.nvm/versions/node/v22.14.0/bin:$PATH node --version > <EVIDENCE_DIR>/node22-node-version.txt
PATH=/Users/blove/.nvm/versions/node/v22.14.0/bin:$PATH pnpm --version > <EVIDENCE_DIR>/node22-pnpm-version.txt
PATH=/Users/blove/.nvm/versions/node/v22.14.0/bin:$PATH pnpm exec tsc --version > <EVIDENCE_DIR>/node22-typescript-version.txt
PATH=/Users/blove/.nvm/versions/node/v24.19.0/bin:$PATH node --version > <EVIDENCE_DIR>/node24-node-version.txt
PATH=/Users/blove/.nvm/versions/node/v24.19.0/bin:$PATH pnpm --version > <EVIDENCE_DIR>/node24-pnpm-version.txt
PATH=/Users/blove/.nvm/versions/node/v24.19.0/bin:$PATH pnpm exec tsc --version > <EVIDENCE_DIR>/node24-typescript-version.txt
```

Expected exact contents: `v22.14.0`, `v24.19.0`, `10.12.1`, and
`Version 6.0.3` for the corresponding files.

- [ ] **Step 3: Run five exact Node 22 samples**

```bash
set -euo pipefail
set -C
for run in 1 2 3 4 5; do
  log=<EVIDENCE_DIR>/node22-run-$run.log
  test ! -e "$log"
  PATH=/Users/blove/.nvm/versions/node/v22.14.0/bin:$PATH \
    pnpm typecheck:performance > "$log" 2>&1
done
```

Expected: every command exits 0. `set -e` stops on the first failure and
`set -C` prevents an existing log from being replaced, so the five exclusive
files prove five consecutive executions without a retry.

- [ ] **Step 4: Run five exact Node 24 samples**

```bash
set -euo pipefail
set -C
for run in 1 2 3 4 5; do
  log=<EVIDENCE_DIR>/node24-run-$run.log
  test ! -e "$log"
  PATH=/Users/blove/.nvm/versions/node/v24.19.0/bin:$PATH \
    pnpm typecheck:performance > "$log" 2>&1
done
```

Expected: all five exit 0 without reruns. If upstream changed public types,
instantiation counts may differ from the design's snapshot, but each fixture must
have one identical count across all ten fresh samples and remain within the
unchanged ceilings.

- [ ] **Step 5: Validate the evidence mechanically**

Run this complete read-only validator after replacing `<EVIDENCE_DIR>` with its
literal Task 1 path:

```bash
node --input-type=module - <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validateTypePerformanceBudgets } from "./scripts/check-type-performance.mjs";

const evidenceDir = "<EVIDENCE_DIR>";
const fixtures = ["columns-100", "columns-500"];
const expectedLogs = ["node22", "node24"].flatMap((runtime) =>
  [1, 2, 3, 4, 5].map((run) => `${runtime}-run-${run}.log`),
);
const actualLogs = readdirSync(evidenceDir)
  .filter((name) => /^node(?:22|24)-run-\d+\.log$/.test(name))
  .sort();
assert.deepEqual(actualLogs, [...expectedLogs].sort());

const expectedVersions = {
  "node22-node-version.txt": "v22.14.0",
  "node22-pnpm-version.txt": "10.12.1",
  "node22-typescript-version.txt": "Version 6.0.3",
  "node24-node-version.txt": "v24.19.0",
  "node24-pnpm-version.txt": "10.12.1",
  "node24-typescript-version.txt": "Version 6.0.3",
};
for (const [name, expected] of Object.entries(expectedVersions)) {
  assert.equal(readFileSync(`${evidenceDir}/${name}`, "utf8").trim(), expected);
}

const budgets = validateTypePerformanceBudgets(
  JSON.parse(readFileSync("type-tests/performance/budgets.json", "utf8"))
    .fixtures,
);
const instantiations = new Map(fixtures.map((fixture) => [fixture, new Set()]));
const memory = new Map();
const summary = /^(columns-(?:100|500)): ([\d,]+) instantiations, ([\d,]+) KiB memory, [\d.]+s check time \(informational\)$/gm;

for (const name of expectedLogs) {
  const text = readFileSync(`${evidenceDir}/${name}`, "utf8");
  const rows = [...text.matchAll(summary)].map((match) => ({
    fixture: match[1],
    instantiations: Number(match[2].replaceAll(",", "")),
    memoryKiB: Number(match[3].replaceAll(",", "")),
  }));
  assert.equal(rows.length, 2, `${name}: expected exactly two summaries`);
  assert.deepEqual(
    rows.map((row) => row.fixture),
    fixtures,
    `${name}: fixture order`,
  );
  for (const row of rows) {
    const budget = budgets[row.fixture];
    instantiations.get(row.fixture).add(row.instantiations);
    assert.ok(
      row.instantiations <= budget.maxInstantiations,
      `${name}: ${row.fixture} ${row.instantiations} instantiations exceeds ${budget.maxInstantiations}`,
    );
    assert.ok(
      row.memoryKiB <= budget.maxMemoryKiB,
      `${name}: ${row.fixture} ${row.memoryKiB} KiB exceeds ${budget.maxMemoryKiB} KiB`,
    );
    const key = `${name.slice(0, 6)}:${row.fixture}`;
    const values = memory.get(key) ?? [];
    values.push(row.memoryKiB);
    memory.set(key, values);
  }
}

for (const fixture of fixtures) {
  assert.equal(
    instantiations.get(fixture).size,
    1,
    `${fixture}: instantiations changed across runs`,
  );
}
for (const [key, values] of [...memory].sort()) {
  console.log(`${key}: ${Math.min(...values)}-${Math.max(...values)} KiB`);
}
NODE
```

Equality with `maxInstantiations` or `maxMemoryKiB` is accepted because the
production gate fails only when an observed metric is greater than its configured
ceiling.

- [ ] **Step 6: Verify no repository mutation**

```bash
git status --porcelain=v1 --untracked-files=all
git diff --check
shasum -a 256 pnpm-lock.yaml
```

Expected: clean and unchanged. Preserve all evidence through both reviews and
the PR verification record.

### Task 5: Run the complete prerequisite release gate

**Files:**

- Verify all owned files and repository state.

- [ ] **Step 1: Fetch and require a stable base**

```bash
set -euo pipefail
set -C
git fetch --prune origin
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
git status --porcelain=v1 --untracked-files=all
git rev-parse origin/main > <EVIDENCE_DIR>/verified-base-sha.txt
```

Expected: main is an ancestor, branch is 0 behind, and the worktree is clean.
Copy the recorded SHA into the execution record as `<VERIFIED_BASE_SHA>`. Stop on
drift; do not merge or rebase inside the verification gate.

- [ ] **Step 2: Run every independent gate, stopping on first failure**

```bash
set -euo pipefail
set -C
run_gate() {
  name=$1
  shift
  log=<EVIDENCE_DIR>/gate-$name.log
  test ! -e "$log"
  : > "$log"
  "$@" 2>&1 | tee -a "$log"
}
run_gate install pnpm install --frozen-lockfile
run_gate test pnpm test
run_gate typecheck pnpm typecheck
run_gate typecheck-public pnpm typecheck:public
run_gate typecheck-performance pnpm typecheck:performance
run_gate lint pnpm lint
run_gate build pnpm build
run_gate api-check pnpm api:check
run_gate lint-packaging pnpm lint:packaging
run_gate publish-preflight pnpm publish:preflight
run_gate format pnpm format
run_gate diff-check git diff --check
run_gate branch-diff-check git diff --check origin/main...HEAD
```

Expected: every command exits 0. `pipefail` preserves the gate's exit status
through `tee`; the exclusive per-gate log blocks overwrite/retry. Do not rerun a
failed command without a completed root-cause investigation and a fresh complete
acceptance attempt under the lifecycle above.

- [ ] **Step 3: Prove release scope**

```bash
git diff --name-status origin/main...HEAD
git diff --name-only origin/main...HEAD -- .changeset packages package.json pnpm-lock.yaml
pnpm exec changeset status
```

Expected branch-owned paths: the design, plan, runner, runner test, and CI workflow only. No branch-owned Changeset, package source, manifest, or lock change. Plain Changesets status may list unrelated main intent but must exit 0.

- [ ] **Step 4: Prove the exact implementation contract**

```bash
rg -n 'expose-gc' scripts/check-type-performance.mjs scripts/__tests__/check-type-performance.test.mjs
rg -n 'pnpm typecheck:performance' .github/workflows/ci.yml
git diff origin/main...HEAD -- type-tests/performance/budgets.json pnpm-lock.yaml
```

Expected: one production flag, one test expectation, one CI command, and empty budget/lock diff.

- [ ] **Step 5: Perform independent reviews**

Request one spec-compliance review and then one code-quality review. Both must inspect the actual diff, RED/GREEN evidence, negative controls, five-run matrices, CI placement, unchanged budgets, warning inventory, exact packaging-advisory baseline, and cleanup. A finding that requires any tracked edit closes the current attempt: preserve its evidence for diagnosis, implement and verify the correction, then use the acceptance-attempt lifecycle to restart Tasks 1–5 from the beginning.

- [ ] **Step 6: Compare warnings, packaging advisories, and repository hygiene mechanically**

Run this read-only classifier after substituting the literal Task 1 evidence
path. It strips ANSI control sequences before selecting and classifying warning
markers, including bounded root, task-prefixed, and TAP-prefixed
case-insensitive `warn:`/`warning:` forms; Node warning types and codes; Unicode
warning signs with either standard variation selector; normal/thin-space-
decorated uppercase `WARN`; pnpm warning-box lines; TypeScript diagnostic,
ESLint warning-detail, webpack-style, bracketed build, and esbuild warning forms;
and anchored `npm warn` forms. It requires every selected marker to map to
exactly one of exactly eight named classes, reconciles each grammar-checked
Turbopack warning summary with same-prefix detailed warning lines in its own
block, and fails on a class not present at baseline:

```bash
node --input-type=module - <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const evidenceDir = "<EVIDENCE_DIR>";
const eslintReactCompilerWarning =
  /\b\d+:\d+\s{2,}warning\s{2,}Compilation Skipped: Use of incompatible library\s*$/;
const apiExtractorTypeScriptVersionWarning =
  /\*\*\* The target project appears to use TypeScript \d+\.\d+\.\d+ which is newer than the bundled compiler engine; consider upgrading API Extractor\.\s*$/;
const classifiers = new Map([
  ["pnpm-esbuild", /Ignored build scripts:\s*esbuild|approve-builds/i],
  [
    "vite-native-config",
    /configLoader.*native|__dirname.*import\.meta\.dirname|VITE_CONFIG_NATIVE_IGNORE_WARNING/i,
  ],
  ["jsdom-canvas", /Not implemented: HTMLCanvasElement/i],
  ["jsdom-navigation", /Not implemented: navigation/i],
  ["vite-large-chunk", /Some chunks are larger than \d+ kB after minification/i],
  ["next-dynamic-fs-tracing", /Dynamic filesystem access causes tracing of the whole project/i],
  ["eslint-react-compiler", eslintReactCompilerWarning],
  [
    "api-extractor-typescript-version",
    apiExtractorTypeScriptVersionWarning,
  ],
]);
const horizontalWarningSpace = String.raw`[\t \u2009]`;
const warningMarkerPrefix = String.raw`(?:^|:${horizontalWarningSpace}+)(?:#${horizontalWarningSpace}+)?${horizontalWarningSpace}*`;
const warningLike = new RegExp(
  String.raw`${warningMarkerPrefix}(?:\(!\)|Not implemented:|VITE_CONFIG_NATIVE_IGNORE_WARNING)`,
);
const pnpmBoxWarningLike =
  /^(?:│|┃)[\t \u2009]+(?:Ignored build scripts:|Run "pnpm approve-builds")/;
const colonWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}warn(?:ing)?:`,
  "i",
);
const nodeWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}(?:\(node:\d+\)${horizontalWarningSpace}+)?(?:\[[A-Za-z0-9_-]+\]${horizontalWarningSpace}+)?(?:[A-Za-z][A-Za-z0-9]*)?Warning:`,
);
const warningSignLike = new RegExp(
  String.raw`${warningMarkerPrefix}\u26a0[\ufe0e\ufe0f]?(?:${horizontalWarningSpace}+|:)`,
);
const decoratedWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}WARN${horizontalWarningSpace}+`,
);
const warningInLike = new RegExp(
  String.raw`${warningMarkerPrefix}WARNING${horizontalWarningSpace}+in${horizontalWarningSpace}+`,
);
const bracketedBuildWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}(?:\u25b2${horizontalWarningSpace}+)?\[WARNING\](?:${horizontalWarningSpace}+|:)`,
);
const typescriptDiagnosticWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}warning${horizontalWarningSpace}+TS\d+:`,
  "i",
);
const eslintWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}\d+:\d+${horizontalWarningSpace}{2,}warning${horizontalWarningSpace}{2,}\S.*$`,
);
const esbuildWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}\[esbuild\]${horizontalWarningSpace}+(?:Ignoring|WARN)(?:${horizontalWarningSpace}+|:)`,
);
const npmWarningLike = new RegExp(
  String.raw`${warningMarkerPrefix}npm${horizontalWarningSpace}+warn${horizontalWarningSpace}+`,
  "i",
);

function isSelectedWarning(line) {
  return (
    warningLike.test(line) ||
    pnpmBoxWarningLike.test(line) ||
    colonWarningLike.test(line) ||
    nodeWarningLike.test(line) ||
    warningSignLike.test(line) ||
    decoratedWarningLike.test(line) ||
    warningInLike.test(line) ||
    bracketedBuildWarningLike.test(line) ||
    typescriptDiagnosticWarningLike.test(line) ||
    eslintWarningLike.test(line) ||
    esbuildWarningLike.test(line) ||
    npmWarningLike.test(line) ||
    eslintReactCompilerWarning.test(line) ||
    apiExtractorTypeScriptVersionWarning.test(line)
  );
}

function matchingClassNames(line) {
  return [...classifiers]
    .filter(([, pattern]) => pattern.test(line))
    .map(([name]) => name);
}

function classifyWarningMarker(file, rawLine) {
  const line = stripVTControlCharacters(rawLine);
  if (!isSelectedWarning(line)) return null;
  const matchedNames = matchingClassNames(line);
  assert.equal(
    matchedNames.length,
    1,
    `${file}: selected warning must match exactly one class; matched classes: ${matchedNames.length === 0 ? "(none)" : matchedNames.join(", ")}; raw line: ${JSON.stringify(rawLine)}`,
  );
  return matchedNames[0];
}

function assertMarkerControls() {
  const positive = [
    {
      expected: "pnpm-esbuild",
      line: "│   Ignored build scripts: esbuild.   │",
    },
    {
      expected: "pnpm-esbuild",
      line: '┃   Run "pnpm approve-builds" to select dependencies.   ┃',
    },
    {
      expected: "vite-native-config",
      line: "VITE_CONFIG_NATIVE_IGNORE_WARNING=true",
    },
    {
      expected: "jsdom-navigation",
      line: "Not implemented: navigation to another Document",
    },
    {
      expected: "jsdom-canvas",
      line: "packages/react test:\tNot implemented: HTMLCanvasElement's getContext() method",
    },
    {
      expected: "vite-large-chunk",
      line: "(!) Some chunks are larger than 500 kB after minification.",
    },
    {
      expected: "eslint-react-compiler",
      line: "apps/bench lint:   312:23  warning  Compilation Skipped: Use of incompatible library",
    },
    {
      expected: "api-extractor-typescript-version",
      line: "*** The target project appears to use TypeScript 6.0.3 which is newer than the bundled compiler engine; consider upgrading API Extractor.",
    },
  ];
  for (const { expected, line } of positive) {
    assert.equal(isSelectedWarning(line), true);
    assert.deepEqual(matchingClassNames(line), [expected]);
    assert.equal(classifyWarningMarker("marker-control", line), expected);
  }

  const unclassifiedWarningMarkers = [
    "Warning: root marker",
    "task: WARNING: ASCII-space task marker",
    "task:\tWARNING: tab-separated task marker",
    "task:\u2009warning: thin-space task marker",
    "# warning: TAP marker",
    "(node:123) Warning: bare Node warning",
    "task: (node:123) ExperimentalWarning: Node marker",
    "(node:123) [DEP0040] DeprecationWarning: coded Node warning",
    "ExperimentalWarning: Node marker without PID wrapper",
    "[DEP0040] DeprecationWarning: coded Node warning without PID wrapper",
    "# (node:123) ExperimentalWarning: TAP Node warning",
    "task:\t(node:123) [DEP0040] DeprecationWarning: task-tab Node warning",
    "\u26a0 Unicode marker without variation selector",
    "\u26a0\ufe0e Unicode marker with FE0E",
    "\u26a0\ufe0f Unicode marker with FE0F",
    "task:\t\u26a0: task-tab Unicode marker",
    "warn: lowercase marker",
    "WARNING in ./src/index.ts",
    "[WARNING] bracketed build warning",
    "task:\t[WARNING] prefixed bracketed build warning",
    "\u25b2 [WARNING] triangular build warning",
    "task:\u2009\u25b2 [WARNING] prefixed triangular build warning",
    "warning TS6385: this declaration is deprecated",
    "task:\twarning TS6385: task-prefixed TypeScript warning",
    "apps/bench lint:   12:7  warning  Unexpected console statement  no-console",
    "  12:7  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any",
    "apps/website lint:\t9:3\t\twarning\t\tUnexpected debugger statement  no-debugger",
    "7:2\u2009\u2009warning\u2009\u2009Unexpected empty block  no-empty",
    "[esbuild] Ignoring this import because it is unused",
    "[esbuild] WARN: unsupported feature",
    "task: [esbuild] WARN task-prefixed warning",
  ];
  for (const line of unclassifiedWarningMarkers) {
    assert.equal(isSelectedWarning(line), true);
    assert.deepEqual(matchingClassNames(line), []);
    assert.throws(
      () => classifyWarningMarker("marker-control", line),
      (error) => {
        assert.match(
          error.message,
          /selected warning must match exactly one class; matched classes: \(none\)/,
        );
        return true;
      },
    );
  }

  const nearMisses = [
    "apps/bench lint: Compilation was skipped while using a compatible library",
    "The target project uses a newer compiler and API Extractor may need an upgrade",
    "Warning signs can describe ordinary prose without a marker",
    "This command can warn users before continuing",
    "An experimental warning is described in ordinary prose",
    "The Warning: section title appears in ordinary prose",
    "The [DEP0040] DeprecationWarning: documentation is ordinary prose",
    "# this TAP comment has no warning marker",
    "task:\tthis warning remains ordinary prose",
    "(node:123) experimental warning remains ordinary prose",
    'Documentation quotes "Not implemented: navigation" as an example',
    'The docs mention "Ignored build scripts" as a heading',
    "Read the approve-builds documentation before continuing",
    "The VITE_CONFIG_NATIVE_IGNORE_WARNING marker is documented here",
    'The phrase "WARNING in examples" appears in documentation',
    "Documentation shows [WARNING] and \u25b2 [WARNING] examples",
    "The warning TS6385: example is described in ordinary prose",
    "Documentation says [esbuild] WARN and [esbuild] Ignoring are supported",
    "Documentation describes 12:7  warning  Unexpected console statement",
    "12:7 warning Unexpected console statement  no-console",
    "12:7  warning Unexpected console statement  no-console",
    "12:7  error  Unexpected console statement  no-console",
    "12:7  note  Unexpected console statement",
    "12:7  warning  ",
    "line 12:7  warning  Unexpected console statement  no-console",
  ];
  for (const line of nearMisses) {
    assert.equal(
      isSelectedWarning(line),
      false,
      `ordinary prose must not be selected as a warning marker: ${JSON.stringify(line)}`,
    );
  }
}

function reconcileTurbopackWarnings(file, rawLines, lines) {
  const summaries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(
      /^(.*?: )?Turbopack build encountered (\d+) (warning(?:s)?):\s*$/,
    );
    if (match === null) continue;
    summaries.push({
      advertisedCount: Number(match[2]),
      index,
      label: match[3],
      prefix: match[1] ?? "",
      rawLine: rawLines[index],
    });
  }

  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    const expectedLabel = summary.advertisedCount === 1 ? "warning" : "warnings";
    assert.equal(
      summary.label,
      expectedLabel,
      `${file}:${summary.index + 1}: Turbopack summary grammar mismatch; raw summary: ${JSON.stringify(summary.rawLine)}; advertised ${summary.advertisedCount} requires ${expectedLabel}, observed ${summary.label}`,
    );
    const end = summaries[index + 1]?.index ?? lines.length;
    const observedCount = lines
      .slice(summary.index + 1, end)
      .filter(
        (line) =>
          line.startsWith(summary.prefix) &&
          /^\s*Warning:/.test(line.slice(summary.prefix.length)),
      ).length;
    assert.equal(
      observedCount,
      summary.advertisedCount,
      `${file}:${summary.index + 1}: Turbopack warning count mismatch; raw summary: ${JSON.stringify(summary.rawLine)}; advertised ${summary.advertisedCount}, observed ${observedCount}`,
    );
  }
}

function classify(files) {
  assertMarkerControls();
  const classes = new Set();
  for (const file of files) {
    const rawText = readFileSync(`${evidenceDir}/${file}`, "utf8");
    const text = stripVTControlCharacters(rawText);
    const rawLines = rawText.split("\n");
    const lines = text.split("\n");
    reconcileTurbopackWarnings(file, rawLines, lines);

    for (let index = 0; index < rawLines.length; index += 1) {
      const rawLine = rawLines[index];
      const matchedName = classifyWarningMarker(file, rawLine);
      if (matchedName !== null) classes.add(matchedName);
    }
  }
  return classes;
}

const names = readdirSync(evidenceDir);
const baseline = classify(names.filter((name) => /^baseline-.*\.log$/.test(name)));
const gates = classify(names.filter((name) => /^gate-.*\.log$/.test(name)));
assert.deepEqual([...baseline].sort(), [...classifiers.keys()].sort());
assert.deepEqual(
  [...gates].filter((name) => !baseline.has(name)),
  [],
  "gate introduced a warning class absent from baseline",
);
console.log(`baseline warning classes: ${[...baseline].sort().join(", ")}`);
console.log(`gate warning classes: ${[...gates].sort().join(", ")}`);
NODE
```

The accepted baseline classes are:

- pnpm ignored `esbuild` build scripts;
- Vite native-config `__dirname` warnings;
- jsdom canvas limitations;
- jsdom navigation limitations;
- Vite large-chunk advisory;
- Next/Turbopack dynamic-filesystem tracing advisory;
- ESLint React Compiler incompatible-library warning;
- API Extractor bundled-TypeScript-version advisory.

Require the set of gate warning classes to be a subset of the baseline class set.

Compare publint advisories separately as structured output. This parser strips
ANSI control sequences, requires every publint package block to have one unique
well-formed header, records packages with zero suggestions, accepts at most one
`Suggestions:` heading per package, requires consecutive numbering from 1, and
normalizes an entry's first line plus indented continuation lines by trimming and
collapsing whitespace before joining them with one ASCII space. Any malformed or
orphan heading or numbered entry fails closed. The package keys and each
package's ordered suggestion texts must deep-equal the Task 1 baseline:

```bash
node --input-type=module - <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const evidenceDir = "<EVIDENCE_DIR>";
const publintHeader =
  /^Running publint v\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)? for ((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)\.\.\.$/;
const publintHeaderLike = /^Running publint\b/;
const suggestionsHeadingLike = /^\s*Suggestions\b/;
const numberedEntry = /^(\d+)\.\s+(\S.*)$/;
const numberedEntryLike = /^\s*\d+[.)](?:\s|$)/;

function normalizeSuggestion(parts) {
  return parts
    .map((part) => part.trim().replace(/\s+/g, " "))
    .join(" ");
}

function assertNoOrphanSyntax(file, lines, startLine) {
  for (const [offset, line] of lines.entries()) {
    assert.equal(
      suggestionsHeadingLike.test(line),
      false,
      `${file}:${startLine + offset}: orphan or malformed Suggestions heading: ${JSON.stringify(line)}`,
    );
    assert.equal(
      numberedEntryLike.test(line),
      false,
      `${file}:${startLine + offset}: orphan or malformed suggestion numbering: ${JSON.stringify(line)}`,
    );
  }
}

function parseSuggestionBlock(file, packageName, lines, startLine) {
  const entries = [];
  let currentParts = null;
  let ended = false;

  for (const [offset, line] of lines.entries()) {
    const lineNumber = startLine + offset;
    const match = line.match(numberedEntry);
    if (match !== null) {
      assert.equal(
        ended,
        false,
        `${file}:${lineNumber}: orphan numbered suggestion after the Suggestions block ended for ${packageName}`,
      );
      if (currentParts !== null) {
        entries.push(normalizeSuggestion(currentParts));
      }
      const expectedNumber = entries.length + 1;
      assert.equal(
        Number(match[1]),
        expectedNumber,
        `${file}:${lineNumber}: ${packageName} suggestion numbering must be consecutive from 1; expected ${expectedNumber}, observed ${match[1]}`,
      );
      currentParts = [match[2]];
      continue;
    }

    assert.equal(
      numberedEntryLike.test(line),
      false,
      `${file}:${lineNumber}: malformed suggestion numbering for ${packageName}: ${JSON.stringify(line)}`,
    );

    if (!ended && currentParts !== null && /^\s+\S/.test(line)) {
      currentParts.push(line);
      continue;
    }

    if (!ended && currentParts === null) {
      assert.fail(
        `${file}:${lineNumber}: Suggestions for ${packageName} must begin immediately with numbered entry 1`,
      );
    }

    if (!ended && currentParts !== null) {
      entries.push(normalizeSuggestion(currentParts));
      currentParts = null;
      ended = true;
    }
  }

  if (currentParts !== null) entries.push(normalizeSuggestion(currentParts));
  assert.ok(
    entries.length > 0,
    `${file}: Suggestions for ${packageName} must contain at least one entry`,
  );
  return entries;
}

function parsePublintSuggestions(file, rawText) {
  const lines = stripVTControlCharacters(rawText)
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const headers = [];

  for (const [index, line] of lines.entries()) {
    if (!publintHeaderLike.test(line)) continue;
    const match = line.match(publintHeader);
    assert.ok(
      match,
      `${file}:${index + 1}: malformed publint package header: ${JSON.stringify(line)}`,
    );
    headers.push({ index, packageName: match[1] });
  }

  assert.ok(headers.length > 0, `${file}: no publint package blocks found`);
  assertNoOrphanSyntax(file, lines.slice(0, headers[0].index), 1);

  const byPackage = new Map();
  for (const [headerOffset, header] of headers.entries()) {
    assert.equal(
      byPackage.has(header.packageName),
      false,
      `${file}:${header.index + 1}: duplicate publint package block for ${header.packageName}`,
    );
    const end = headers[headerOffset + 1]?.index ?? lines.length;
    const block = lines.slice(header.index + 1, end);
    const headingIndexes = [];

    for (const [offset, line] of block.entries()) {
      if (!suggestionsHeadingLike.test(line)) continue;
      assert.equal(
        line,
        "Suggestions:",
        `${file}:${header.index + offset + 2}: malformed Suggestions heading for ${header.packageName}: ${JSON.stringify(line)}`,
      );
      headingIndexes.push(offset);
    }

    assert.ok(
      headingIndexes.length <= 1,
      `${file}:${header.index + 1}: duplicate Suggestions headings for ${header.packageName}`,
    );

    if (headingIndexes.length === 0) {
      assertNoOrphanSyntax(file, block, header.index + 2);
      byPackage.set(header.packageName, []);
      continue;
    }

    const headingIndex = headingIndexes[0];
    assertNoOrphanSyntax(
      file,
      block.slice(0, headingIndex),
      header.index + 2,
    );
    const suggestions = parseSuggestionBlock(
      file,
      header.packageName,
      block.slice(headingIndex + 1),
      header.index + headingIndex + 3,
    );
    byPackage.set(header.packageName, suggestions);
  }

  return Object.fromEntries(
    [...byPackage].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertSamePublintSuggestions(
  baselineFile,
  baselineText,
  gateFile,
  gateText,
) {
  assert.deepEqual(
    parsePublintSuggestions(gateFile, gateText),
    parsePublintSuggestions(baselineFile, baselineText),
    `${gateFile}: publint package set or ordered Suggestions changed from ${baselineFile}`,
  );
}

function assertPublintSuggestionControls() {
  const baseline = [
    "Running publint v0.3.23 for @scope/alpha...",
    "Packing files...",
    "Suggestions:",
    '1. The package does not specify "engines.node".',
    "   Consumers may install it on an unsupported runtime.",
    '2. The package does not specify "sideEffects".',
    "",
    "@scope/alpha v1.0.0",
    "Running publint v0.3.23 for @scope/beta...",
    "Packing files...",
    "No problems found",
  ].join("\n");
  const added = baseline.replace(
    '2. The package does not specify "sideEffects".',
    '2. The package does not specify "sideEffects".\n3. Added advisory.',
  );
  const removed = baseline.replace(
    '\n2. The package does not specify "sideEffects".',
    "",
  );
  const changed = baseline.replace(
    '2. The package does not specify "sideEffects".',
    '2. The package changed its "sideEffects" advisory.',
  );
  const duplicateHeading = baseline.replace(
    "Suggestions:",
    "Suggestions:\nSuggestions:",
  );
  const duplicatePackage = `${baseline}\nRunning publint v0.3.23 for @scope/alpha...\nNo problems found`;
  const malformed = baseline.replace(
    '2. The package does not specify "sideEffects".',
    '3. The package does not specify "sideEffects".',
  );
  const malformedHeading = baseline.replace("Suggestions:", "Suggestions :");
  const malformedNumbering = baseline.replace(
    '1. The package does not specify "engines.node".',
    '1) The package does not specify "engines.node".',
  );
  const orphan = `1. Orphan advisory.\n${baseline}`;
  const orphanHeading = `Suggestions:\n1. Orphan advisory.\n${baseline}`;

  assert.doesNotThrow(() =>
    assertSamePublintSuggestions("baseline", baseline, "gate", baseline),
  );
  for (const candidate of [added, removed, changed]) {
    assert.throws(() =>
      assertSamePublintSuggestions("baseline", baseline, "gate", candidate),
    );
  }
  for (const candidate of [
    duplicateHeading,
    duplicatePackage,
    malformed,
    malformedHeading,
    malformedNumbering,
    orphan,
    orphanHeading,
  ]) {
    assert.throws(() => parsePublintSuggestions("control", candidate));
  }
}

assertPublintSuggestionControls();
const baselineFile = "baseline-lint-packaging.log";
const gateFile = "gate-lint-packaging.log";
const baselineText = readFileSync(`${evidenceDir}/${baselineFile}`, "utf8");
const gateText = readFileSync(`${evidenceDir}/${gateFile}`, "utf8");
assertSamePublintSuggestions(
  baselineFile,
  baselineText,
  gateFile,
  gateText,
);
const inventory = parsePublintSuggestions(gateFile, gateText);
console.log(`publint package advisories: ${JSON.stringify(inventory)}`);
NODE
```

Then run:

```bash
set -euo pipefail
set -C
git status --ignored --porcelain=v1 --untracked-files=all > <EVIDENCE_DIR>/ignored-status-final.txt
```

Compare the ignored inventories as exact line sets while allowing only the
mechanically expected gate outputs and coherent bench JS/map, bench CSS, Next
manifest, and Next chunk rotations. Numeric Turbopack cache entries permit two
coherent transition types within an existing namespace: a normal visible
eight-entry append that may retire prior `.del` metadata but removes no data
segments, or a compaction transaction terminated by one binary `.del` manifest
whose exact deletion IDs reconcile all removed baseline data segments
(`.sst`/`.meta`) and any transient transaction IDs that are no longer visible. A
removed prior `.del` is superseded transaction metadata: it may accompany either
transition type and its ID must not appear in a new deletion payload:

```bash
node --input-type=module - <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = "<EVIDENCE_DIR>";
const benchAssetPattern =
  /^apps\/bench\/dist\/assets\/index-([A-Za-z0-9_-]{8,64})\.(js(?:\.map)?)$/;
const benchCssAssetPattern =
  /^apps\/bench\/dist\/assets\/index-([A-Za-z0-9_-]{8,64})\.css$/;
const nextManifestPattern =
  /^apps\/website\/\.next\/static\/([A-Za-z0-9_-]{1,128})\/(_buildManifest\.js|_clientMiddlewareManifest\.js|_ssgManifest\.js)$/;
const nextChunkPattern =
  /^apps\/website\/\.next\/static\/chunks\/([A-Za-z0-9_-]{8,64})\.js$/;
const turbopackCachePattern =
  /^(apps\/website\/\.next\/cache\/turbopack\/[A-Za-z0-9._-]{1,128})\/(\d{8})\.(sst|meta|del)$/;
const packageTypecheckBuildInfo = [
  "bench-runner",
  "core",
  "grid-core",
  "layout-core",
  "react",
  "renderer-dom",
  "row-model",
  "scenario-data",
  "stream-adapter",
  "text-core",
  "ui",
].map((name) => `packages/${name}/tsconfig.typecheck.tsbuildinfo`);
const exactAllowedAdditions = new Set([
  "apps/bench/tsconfig.tsbuildinfo",
  "apps/website/tsconfig.tsbuildinfo",
  ...packageTypecheckBuildInfo,
  "packages/stream-adapter/tsconfig.tsbuildinfo",
  "packages/core/temp/core.api.md",
  "packages/react/temp/react.api.md",
  "packages/stream-adapter/temp/stream-adapter.api.md",
  "packages/ui/temp/ui.api.md",
]);

function readInventory(name) {
  const lines = readFileSync(join(evidenceDir, name), "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  assert.ok(lines.length > 0, `${name}: ignored inventory must not be empty`);

  const paths = new Set();
  for (const [index, line] of lines.entries()) {
    assert.ok(
      line.startsWith("!! "),
      `${name}:${index + 1}: ignored inventory line must start exactly with "!! ": ${JSON.stringify(line)}`,
    );
    const path = line.slice(3);
    assert.ok(
      path.length > 0,
      `${name}:${index + 1}: ignored inventory path is empty`,
    );
    assert.ok(
      !paths.has(path),
      `${name}:${index + 1}: duplicate ignored path: ${JSON.stringify(path)}`,
    );
    paths.add(path);
  }
  return paths;
}

function difference(left, right) {
  return [...left].filter((path) => !right.has(path)).sort();
}

function categorize(paths, side) {
  const categories = {
    bench: [],
    benchCss: [],
    cache: [],
    next: [],
    nextChunk: [],
    other: [],
  };
  for (const path of paths) {
    if (benchAssetPattern.test(path)) {
      categories.bench.push(path);
    } else if (benchCssAssetPattern.test(path)) {
      categories.benchCss.push(path);
    } else if (nextManifestPattern.test(path)) {
      categories.next.push(path);
    } else if (nextChunkPattern.test(path)) {
      categories.nextChunk.push(path);
    } else if (turbopackCachePattern.test(path)) {
      categories.cache.push(path);
    } else if (
      side === "added" &&
      exactAllowedAdditions.has(path)
    ) {
      categories.other.push(path);
    } else {
      assert.fail(
        `${side} ignored path is not allowlisted: ${JSON.stringify(path)}`,
      );
    }
  }
  return categories;
}

function validateBenchRotation(paths, side) {
  if (paths.length === 0) return null;
  assert.equal(
    paths.length,
    2,
    `${side} bench rotation must contain exactly a .js/.js.map pair: ${JSON.stringify(paths)}`,
  );
  const matches = paths.map((path) => {
    const match = path.match(benchAssetPattern);
    assert.ok(match, `${side} bench path did not match: ${JSON.stringify(path)}`);
    return { hash: match[1], suffix: match[2] };
  });
  assert.equal(
    new Set(matches.map(({ hash }) => hash)).size,
    1,
    `${side} bench pair must share one hash: ${JSON.stringify(paths)}`,
  );
  assert.deepEqual(
    matches.map(({ suffix }) => suffix).sort(),
    ["js", "js.map"],
    `${side} bench rotation must contain one .js and one .js.map: ${JSON.stringify(paths)}`,
  );
  return matches[0].hash;
}

function validateBenchCssRotation(removedPaths, addedPaths) {
  if (removedPaths.length === 0 && addedPaths.length === 0) return;
  assert.equal(
    removedPaths.length,
    1,
    `bench CSS rotation must remove exactly one asset when present: ${JSON.stringify(removedPaths)}`,
  );
  assert.equal(
    addedPaths.length,
    1,
    `bench CSS rotation must add exactly one asset when present: ${JSON.stringify(addedPaths)}`,
  );

  const removedMatch = removedPaths[0].match(benchCssAssetPattern);
  const addedMatch = addedPaths[0].match(benchCssAssetPattern);
  assert.ok(
    removedMatch,
    `removed bench CSS asset did not match: ${JSON.stringify(removedPaths[0])}`,
  );
  assert.ok(
    addedMatch,
    `added bench CSS asset did not match: ${JSON.stringify(addedPaths[0])}`,
  );
  assert.notEqual(
    removedMatch[1],
    addedMatch[1],
    `bench CSS rotation must change hash: ${JSON.stringify(removedMatch[1])}`,
  );
}

function validateNextRotation(paths, side) {
  if (paths.length === 0) return null;
  assert.equal(
    paths.length,
    3,
    `${side} Next rotation must contain exactly three manifests: ${JSON.stringify(paths)}`,
  );
  const matches = paths.map((path) => {
    const match = path.match(nextManifestPattern);
    assert.ok(match, `${side} Next path did not match: ${JSON.stringify(path)}`);
    return { buildId: match[1], manifest: match[2] };
  });
  assert.equal(
    new Set(matches.map(({ buildId }) => buildId)).size,
    1,
    `${side} Next manifests must share one build ID: ${JSON.stringify(paths)}`,
  );
  assert.deepEqual(
    matches.map(({ manifest }) => manifest).sort(),
    [
      "_buildManifest.js",
      "_clientMiddlewareManifest.js",
      "_ssgManifest.js",
    ],
    `${side} Next rotation has an incomplete manifest set: ${JSON.stringify(paths)}`,
  );
  return matches[0].buildId;
}

function validateNextChunkRotation(removedPaths, addedPaths) {
  if (removedPaths.length === 0 && addedPaths.length === 0) return;
  assert.equal(
    removedPaths.length,
    1,
    `Next chunk rotation must remove exactly one chunk when present: ${JSON.stringify(removedPaths)}`,
  );
  assert.equal(
    addedPaths.length,
    1,
    `Next chunk rotation must add exactly one chunk when present: ${JSON.stringify(addedPaths)}`,
  );

  const removedMatch = removedPaths[0].match(nextChunkPattern);
  const addedMatch = addedPaths[0].match(nextChunkPattern);
  assert.ok(
    removedMatch,
    `removed Next chunk path did not match: ${JSON.stringify(removedPaths[0])}`,
  );
  assert.ok(
    addedMatch,
    `added Next chunk path did not match: ${JSON.stringify(addedPaths[0])}`,
  );
  assert.notEqual(
    removedMatch[1],
    addedMatch[1],
    `Next chunk rotation must change hash: ${JSON.stringify(removedMatch[1])}`,
  );
}

function parseCacheEntries(paths, side) {
  return paths.map((path) => {
    const match = path.match(turbopackCachePattern);
    assert.ok(
      match,
      `${side} Turbopack cache path did not match: ${JSON.stringify(path)}`,
    );
    return {
      id: Number(match[2]),
      namespace: match[1],
      path,
      suffix: match[3],
    };
  });
}

function baselineEntriesForNamespace(before, namespace) {
  return [...before]
    .map((path) => {
      const match = path.match(turbopackCachePattern);
      if (match === null || match[1] !== namespace) return null;
      return {
        id: Number(match[2]),
        namespace: match[1],
        path,
        suffix: match[3],
      };
    })
    .filter((entry) => entry !== null);
}

function validateNormalTurbopackAppend(before, removed, additions) {
  const removedDataSegments = removed.filter(
    ({ suffix }) => suffix === "sst" || suffix === "meta",
  );
  assert.deepEqual(
    removedDataSegments,
    [],
    `normal Turbopack append forbids sst/meta data-segment removals: ${JSON.stringify(removedDataSegments.map(({ path }) => path))}`,
  );
  assert.equal(
    additions.length,
    8,
    `normal Turbopack append must contain exactly eight visible entries: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );
  assert.equal(
    new Set([...removed, ...additions].map(({ namespace }) => namespace)).size,
    1,
    `normal Turbopack append and retired manifests must use exactly one namespace: ${JSON.stringify([...removed, ...additions].map(({ path }) => path))}`,
  );

  const namespace = additions[0].namespace;
  const baselineEntries = baselineEntriesForNamespace(before, namespace);
  assert.ok(
    baselineEntries.length > 0,
    `normal Turbopack append must continue an existing namespace: ${JSON.stringify(namespace)}`,
  );
  const baselineMax = Math.max(...baselineEntries.map(({ id }) => id));
  const ordered = [...additions].sort((left, right) => left.id - right.id);
  assert.deepEqual(
    ordered.map(({ id }) => id),
    Array.from({ length: 8 }, (_, index) => baselineMax + index + 1),
    `normal Turbopack append IDs must be the consecutive range after the true baseline maximum ${baselineMax}: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );
  assert.deepEqual(
    ordered.map(({ suffix }) => suffix),
    ["sst", "sst", "sst", "sst", "meta", "meta", "meta", "meta"],
    `normal Turbopack append must contain four sst entries followed by four meta entries: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );
}

function readDeletionIds(path, readDeletionPayload) {
  const payload = readDeletionPayload(path);
  assert.ok(Buffer.isBuffer(payload), `${path}: deletion payload must be a Buffer`);
  assert.ok(payload.length > 0, `${path}: deletion payload must not be empty`);
  assert.equal(
    payload.length % 4,
    0,
    `${path}: deletion payload must be aligned to four-byte uint32 values`,
  );

  const ids = [];
  for (let offset = 0; offset < payload.length; offset += 4) {
    ids.push(payload.readUInt32BE(offset));
  }
  for (let index = 1; index < ids.length; index += 1) {
    assert.ok(
      ids[index] > ids[index - 1],
      `${path}: deletion IDs must be strictly increasing and unique: ${JSON.stringify(ids)}`,
    );
  }
  return ids;
}

function validateTurbopackCompaction(
  before,
  removed,
  additions,
  readDeletionPayload,
) {
  const deletionEntries = additions.filter(({ suffix }) => suffix === "del");
  assert.equal(
    deletionEntries.length,
    1,
    `Turbopack compaction must add exactly one deletion manifest: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );
  const namespaces = new Set(
    [...removed, ...additions].map(({ namespace }) => namespace),
  );
  assert.equal(
    namespaces.size,
    1,
    `Turbopack compaction must affect exactly one namespace: ${JSON.stringify([...namespaces])}`,
  );

  const namespace = additions[0].namespace;
  const baselineEntries = baselineEntriesForNamespace(before, namespace);
  assert.ok(
    baselineEntries.length > 0,
    `Turbopack compaction must continue an existing namespace: ${JSON.stringify(namespace)}`,
  );
  const baselineMax = Math.max(...baselineEntries.map(({ id }) => id));
  for (const entry of additions) {
    assert.ok(
      entry.id > baselineMax,
      `Turbopack compaction added ID ${entry.id} at or below the true baseline maximum ${baselineMax}: ${JSON.stringify(entry.path)}`,
    );
  }

  const visibleIds = additions.map(({ id }) => id);
  assert.equal(
    new Set(visibleIds).size,
    visibleIds.length,
    `Turbopack compaction visible transaction IDs must be unique: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );
  const deletionEntry = deletionEntries[0];
  assert.equal(
    deletionEntry.id,
    Math.max(...visibleIds),
    `Turbopack deletion manifest must be the highest visible transaction ID: ${JSON.stringify(additions.map(({ path }) => path))}`,
  );

  const transactionIds = Array.from(
    { length: deletionEntry.id - baselineMax },
    (_, index) => baselineMax + index + 1,
  );
  const transactionIdSet = new Set(transactionIds);
  for (const entry of additions) {
    assert.ok(
      transactionIdSet.has(entry.id),
      `Turbopack visible ID ${entry.id} is outside transaction range ${baselineMax + 1}..${deletionEntry.id}: ${JSON.stringify(entry.path)}`,
    );
  }

  const visibleIdSet = new Set(visibleIds);
  const transientMissingIds = transactionIds.filter(
    (id) => !visibleIdSet.has(id),
  );
  const removedBaselineDataIds = removed
    .filter(({ suffix }) => suffix === "sst" || suffix === "meta")
    .map(({ id }) => id);
  const expectedDeletionIds = [
    ...new Set([...removedBaselineDataIds, ...transientMissingIds]),
  ].sort((left, right) => left - right);
  const observedDeletionIds = readDeletionIds(
    deletionEntry.path,
    readDeletionPayload,
  );
  assert.deepEqual(
    observedDeletionIds,
    expectedDeletionIds,
    `${deletionEntry.path}: deletion payload must exactly equal removed baseline data-segment IDs plus transient missing transaction IDs; superseded deletion-manifest IDs are excluded`,
  );
}

function validateTurbopackCacheTransition(
  before,
  removedCachePaths,
  addedCachePaths,
  readDeletionPayload = readFileSync,
) {
  if (removedCachePaths.length === 0 && addedCachePaths.length === 0) return;
  const removed = parseCacheEntries(removedCachePaths, "removed");
  const additions = parseCacheEntries(addedCachePaths, "added");
  for (const entry of removed) {
    assert.equal(
      before.has(entry.path),
      true,
      `removed Turbopack cache path must exist in the baseline inventory: ${JSON.stringify(entry.path)}`,
    );
  }
  for (const entry of additions) {
    assert.equal(
      before.has(entry.path),
      false,
      `added Turbopack cache path must not exist in the baseline inventory: ${JSON.stringify(entry.path)}`,
    );
  }
  const deletionEntries = additions.filter(({ suffix }) => suffix === "del");

  if (deletionEntries.length === 0) {
    validateNormalTurbopackAppend(before, removed, additions);
    return;
  }
  validateTurbopackCompaction(
    before,
    removed,
    additions,
    readDeletionPayload,
  );
}

function cacheControlPath(namespace, id, suffix) {
  return `${namespace}/${String(id).padStart(8, "0")}.${suffix}`;
}

function deletionPayload(ids) {
  const payload = Buffer.alloc(ids.length * 4);
  for (const [index, id] of ids.entries()) {
    payload.writeUInt32BE(id, index * 4);
  }
  return payload;
}

function payloadReader(expectedPath, payload) {
  return (path) => {
    assert.equal(path, expectedPath);
    return payload;
  };
}

function assertTurbopackCacheControls() {
  const namespace =
    "apps/website/.next/cache/turbopack/v16.3.0-control";
  const otherNamespace =
    "apps/website/.next/cache/turbopack/v16.3.0-other";
  const path = (id, suffix, target = namespace) =>
    cacheControlPath(target, id, suffix);
  const before = new Set([
    path(5, "sst"),
    path(10, "meta"),
    path(179, "del"),
    path(185, "del"),
  ]);
  const normalAdditions = [
    path(186, "sst"),
    path(187, "sst"),
    path(188, "sst"),
    path(189, "sst"),
    path(190, "meta"),
    path(191, "meta"),
    path(192, "meta"),
    path(193, "meta"),
  ];
  assert.doesNotThrow(() =>
    validateTurbopackCacheTransition(
      before,
      [path(185, "del")],
      normalAdditions,
    ),
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(
        before,
        [path(5, "sst")],
        normalAdditions,
      ),
    /normal Turbopack append forbids sst\/meta data-segment removals/,
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(
        before,
        [path(10, "meta")],
        normalAdditions,
      ),
    /normal Turbopack append forbids sst\/meta data-segment removals/,
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(before, [], normalAdditions.slice(0, 7)),
    /must contain exactly eight visible entries/,
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(before, [], [
        ...normalAdditions.slice(0, 7),
        path(194, "meta"),
      ]),
    /must be the consecutive range/,
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(before, [], [
        ...normalAdditions.slice(0, 7),
        path(193, "sst"),
      ]),
    /must contain four sst entries followed by four meta entries/,
  );

  const removed = [path(5, "sst"), path(10, "meta"), path(179, "del")];
  const compactionAdditions = [
    path(186, "sst"),
    path(188, "sst"),
    path(189, "sst"),
    path(190, "meta"),
    path(191, "meta"),
    path(192, "meta"),
    path(193, "meta"),
    path(194, "sst"),
    path(195, "sst"),
    path(196, "meta"),
    path(197, "del"),
  ];
  const validPayload = deletionPayload([5, 10, 187]);
  const validateCompaction = (
    candidateRemoved = removed,
    candidateAdditions = compactionAdditions,
    payload = validPayload,
  ) =>
    validateTurbopackCacheTransition(
      before,
      candidateRemoved,
      candidateAdditions,
      payloadReader(
        candidateAdditions.find((candidate) => candidate.endsWith(".del")),
        payload,
      ),
    );

  assert.doesNotThrow(() => validateCompaction());
  assert.throws(
    () =>
      validateCompaction(removed, [
        path(185, "sst"),
        ...compactionAdditions.slice(1),
      ]),
    /at or below the true baseline maximum/,
  );
  assert.throws(
    () =>
      validateCompaction(
        removed,
        compactionAdditions,
        deletionPayload([5, 187]),
      ),
    /deletion payload must exactly equal/,
  );
  assert.throws(
    () =>
      validateCompaction(
        removed,
        compactionAdditions,
        deletionPayload([5, 10, 179, 187]),
      ),
    /deletion payload must exactly equal/,
  );
  assert.throws(
    () =>
      validateCompaction(
        removed,
        compactionAdditions,
        deletionPayload([5, 10, 42, 187]),
      ),
    /deletion payload must exactly equal/,
  );
  assert.throws(
    () =>
      validateCompaction(
        removed,
        compactionAdditions,
        deletionPayload([5, 10]),
      ),
    /deletion payload must exactly equal/,
  );
  assert.throws(
    () =>
      validateCompaction(removed, [
        ...compactionAdditions.slice(0, -1),
        path(197, "del", otherNamespace),
      ]),
    /must affect exactly one namespace/,
  );
  const newNamespaceAdditions = compactionAdditions.map((candidate) =>
    candidate.replace(namespace, otherNamespace),
  );
  assert.throws(
    () =>
      validateTurbopackCacheTransition(
        before,
        [],
        newNamespaceAdditions,
        payloadReader(
          path(197, "del", otherNamespace),
          deletionPayload([187]),
        ),
      ),
    /must continue an existing namespace/,
  );
  assert.throws(
    () =>
      validateCompaction(removed, [
        ...compactionAdditions,
        path(196, "del"),
      ]),
    /must add exactly one deletion manifest/,
  );
  for (const [malformedPayload, expectedError] of [
    [Buffer.alloc(0), /must not be empty/],
    [Buffer.alloc(3), /aligned to four-byte/],
    [deletionPayload([10, 5, 179, 187]), /strictly increasing and unique/],
    [
      deletionPayload([5, 10, 10, 179, 187]),
      /strictly increasing and unique/,
    ],
  ]) {
    assert.throws(
      () =>
        validateCompaction(removed, compactionAdditions, malformedPayload),
      expectedError,
    );
  }
  assert.throws(
    () =>
      validateCompaction(removed, [
        ...compactionAdditions,
        path(198, "sst"),
      ]),
    /must be the highest visible transaction ID/,
  );
  assert.throws(
    () =>
      validateCompaction(removed, [
        ...compactionAdditions,
        path(196, "sst"),
      ]),
    /visible transaction IDs must be unique/,
  );
  console.log(
    "Turbopack cache synthetic controls: 2 pass paths and 19 rejection paths passed",
  );
}

function validateDelta(before, after) {
  const removed = difference(before, after);
  const added = difference(after, before);
  const removedByCategory = categorize(removed, "removed");
  const addedByCategory = categorize(added, "added");

  const oldBenchHash = validateBenchRotation(
    removedByCategory.bench,
    "removed",
  );
  const newBenchHash = validateBenchRotation(addedByCategory.bench, "added");
  assert.equal(
    oldBenchHash === null,
    newBenchHash === null,
    `bench rotation must be absent on both sides or present on both sides; removed: ${JSON.stringify(removedByCategory.bench)}; added: ${JSON.stringify(addedByCategory.bench)}`,
  );
  if (oldBenchHash !== null && newBenchHash !== null) {
    assert.notEqual(
      oldBenchHash,
      newBenchHash,
      `bench rotation must change hash: ${JSON.stringify(oldBenchHash)}`,
    );
  }

  validateBenchCssRotation(
    removedByCategory.benchCss,
    addedByCategory.benchCss,
  );

  const oldBuildId = validateNextRotation(removedByCategory.next, "removed");
  const newBuildId = validateNextRotation(addedByCategory.next, "added");
  assert.equal(
    oldBuildId === null,
    newBuildId === null,
    `Next rotation must be absent on both sides or present on both sides; removed: ${JSON.stringify(removedByCategory.next)}; added: ${JSON.stringify(addedByCategory.next)}`,
  );
  if (oldBuildId !== null && newBuildId !== null) {
    assert.notEqual(
      oldBuildId,
      newBuildId,
      `Next rotation must change build ID: ${JSON.stringify(oldBuildId)}`,
    );
  }

  validateNextChunkRotation(
    removedByCategory.nextChunk,
    addedByCategory.nextChunk,
  );

  validateTurbopackCacheTransition(
    before,
    removedByCategory.cache,
    addedByCategory.cache,
  );

  return { added, removed };
}

function printAudit(label, marker, paths) {
  console.log(`${label} (${paths.length}):`);
  if (paths.length === 0) console.log("  (none)");
  for (const path of paths) console.log(`${marker} ${path}`);
}

assertTurbopackCacheControls();
const before = readInventory("ignored-status-after-baseline.txt");
const after = readInventory("ignored-status-final.txt");
const { added, removed } = validateDelta(before, after);
printAudit("removed ignored paths", "-", removed);
printAudit("added ignored paths", "+", added);
NODE
```

Then run the remaining hygiene checks:

```bash
set -euo pipefail
set -C
ps -axo pid,ppid,stat,etime,command > <EVIDENCE_DIR>/process-after-gates.txt
git status --porcelain=v1 --untracked-files=all
shasum -a 256 pnpm-lock.yaml
```

Expected: no new warning class; no unexpected ignored artifact beyond the
mechanically allowlisted gate outputs, coherent hashed rotations, and either a
strict normal Turbopack append with only optional retired-manifest removal or an
exactly reconciled Turbopack compaction; no active process from this worktree;
empty repository status; and the same lock hash.

- [ ] **Step 7: Terminal base stability**

Fetch once more and require the exact recorded base, not merely ancestry:

```bash
git fetch --prune origin
test "$(git rev-parse origin/main)" = "<VERIFIED_BASE_SHA>"
test "$(git merge-base origin/main HEAD)" = "<VERIFIED_BASE_SHA>"
git rev-list --left-right --count origin/main...HEAD
```

If main advanced, stop and preserve the attempt for reassessment. Rebase only
after inspecting the upstream delta, close the failed attempt under the lifecycle
above, and restart Tasks 1–5; none of the previous acceptance evidence authorizes
a merge. Preserve successful evidence through PR and post-merge verification.

### Task 6: Publish the prerequisite PR and merge on green

**Files:**

- GitHub state only; no new repository edits.

- [ ] **Step 1: Use the finishing workflow**

Invoke @superpowers:finishing-a-development-branch and @superpowers:verification-before-completion. Confirm the user-authorized outcome remains “PR, merge on green.”

- [ ] **Step 2: Push without rewriting remote history**

Verify no existing remote branch or unexpected PR owns `blove/type-performance-determinism`, then push the current branch normally. Do not force-push.

- [ ] **Step 3: Open the PR with exact scope**

Title:

```text
fix: make type performance memory deterministic
```

Body:

```markdown
## Summary

- run the workspace TypeScript CLI through GC-enabled Node before measuring compiler heap
- keep every fixture and budget unchanged
- enforce the repaired performance gate in the existing required typecheck CI job

## Verification

- focused invocation and workflow contract tests, including negative controls
- five consecutive performance runs per runtime on Node 22 and Node 24, with identical instantiation counts
- full repository test, typecheck, public typecheck, exact `pnpm typecheck:performance`, lint, build, API, packaging, publish-preflight, format, and diff gates

## Release

No Changeset: internal test and CI infrastructure only.
```

Do not mention automated assistants or include unrelated work.

- [ ] **Step 4: Monitor every applicable check to terminal**

Require every applicable PR check/job—not only branch-protection-required
contexts—to finish successfully. This includes CI, public typecheck, examples,
development smoke, benchmarks, publish preflight, CodeQL, and any other job
emitted for the PR. OpenSSF Scorecard is explicitly expected to be absent because
its workflow has no `pull_request` trigger; monitor it post-merge instead. A
skipped job is acceptable only when the workflow makes that skip expected for
this PR event/path and the reason is recorded explicitly; cancelled, neutral,
stale, or any other silently absent job is not green. Inspect the `typecheck` job
log and prove it executed both `pnpm typecheck` and the exact
`pnpm typecheck:performance` command successfully. A green workflow that skipped
the new command is not acceptable.

- [ ] **Step 5: Revalidate freshness and merge only the verified head**

Record the PR head SHA as `<PR_HEAD_SHA>`. Immediately before merging, fetch and
require all of the following:

```bash
git fetch --prune origin
test "$(git rev-parse origin/main)" = "<VERIFIED_BASE_SHA>"
test "$(git merge-base origin/main <PR_HEAD_SHA>)" = "<VERIFIED_BASE_SHA>"
test "$(git rev-parse HEAD)" = "<PR_HEAD_SHA>"
gh pr merge --help | rg -- '--match-head-commit'
```

Also re-read the PR title/body, changed paths, and check states and require them
to match the verified local state. If main advanced, stop, preserve and close the
attempt under the lifecycle above, rebase after inspecting the upstream delta,
and restart the complete verification and PR checks. If any PR state changed,
stop and reassess it. Do not enable delayed auto-merge. With all checks already terminal,
perform an immediate head-guarded squash merge:

```bash
gh pr merge <PR_NUMBER> --squash --match-head-commit <PR_HEAD_SHA> --delete-branch
```

Record `<MERGE_SHA>`, fetch main, and verify that the squash commit tree equals
the PR head tree:

```bash
git fetch --prune origin
test "$(git rev-parse <MERGE_SHA>^)" = "<VERIFIED_BASE_SHA>"
test "$(git show -s --format=%T <MERGE_SHA>)" = "$(git show -s --format=%T <PR_HEAD_SHA>)"
git merge-base --is-ancestor <MERGE_SHA> origin/main
```

- [ ] **Step 6: Verify post-merge main**

Monitor same-commit CI, Release, CodeQL, OpenSSF, production deployment, and production smoke to terminal. Release must report no branch-owned Changeset or package publication. Verify main contains the GC-enabled invocation and required CI step.

- [ ] **Step 7: Remove only the bounded evidence directory**

After PR and post-merge verification are complete, remove only the canonical
literal evidence path established in Task 1:

```bash
test "<EVIDENCE_DIR>" = "$(realpath <EVIDENCE_DIR>)"
case "<EVIDENCE_DIR>" in
  /tmp/pretable-typeperf-acceptance.*|/private/tmp/pretable-typeperf-acceptance.*) ;;
  *) exit 1 ;;
esac
find "<EVIDENCE_DIR>" -depth -delete
test ! -e "<EVIDENCE_DIR>"
git status --porcelain=v1 --untracked-files=all
```

- [ ] **Step 8: Hand off to security modernization**

Report the exact prerequisite merge SHA. The next authorized operation is to rebase `/Users/blove/repos/pretable/.worktrees/security-modernization` onto that main commit and restart its complete PR1 release gate from the beginning.
