# Tombstoned Release Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the release workflow before publishing when a local public package version is inactive but retained in registry history, while preserving same-batch and dependency behavior for active and genuinely new versions.

**Architecture:** Replace the registry reader's single version array with cached active and historical version sets from the same packument response. Classify local public packages before dependency validation, reject every historical-only local version deterministically, and continue using only active versions for dependency ranges. Keep the change internal to release tooling and correct the stream-adapter's historical changelog without creating a package release.

**Tech Stack:** Node.js ESM, Node test runner, `semver`, pnpm workspaces, Changesets, npm packuments, Git, GitHub Actions.

---

## File map

| File | Responsibility |
| --- | --- |
| `scripts/publish-preflight.mjs` | Parse active/historical registry state, classify same-batch versus withdrawn local versions, and validate dependencies from active versions only. |
| `scripts/__tests__/publish-preflight.test.mjs` | Model packument `versions`/`time`, lock the three classification states, malformed metadata behavior, and historical-only dependency behavior. |
| `scripts/__tests__/publish-public-packages.test.mjs` | Existing proof that a rejected preflight prevents the Changesets subprocess; verify unchanged. |
| `packages/stream-adapter/CHANGELOG.md` | Correct the withdrawn `0.1.0`, abandoned `0.1.1`, and next-published `0.2.0` history. |
| `docs/superpowers/specs/2026-08-10-release-preflight-tombstones-design.md` | Approved behavior, limitations, and acceptance contract; no implementation edits expected. |
| `docs/superpowers/plans/2026-08-10-release-preflight-tombstones.md` | This test-first execution checklist. |

No Changeset is required. The script is repository-only, and
`packages/stream-adapter/package.json` publishes only `dist`, excluding the
historical changelog correction from the npm artifact.

### Task 1: Synchronize and record the release-tool baseline

**Files:**

- Verify: `scripts/publish-preflight.mjs`
- Verify: `scripts/__tests__/publish-preflight.test.mjs`
- Verify: `scripts/__tests__/publish-public-packages.test.mjs`
- Verify: `packages/stream-adapter/CHANGELOG.md`

- [ ] **Step 1: Confirm the branch is clean and synchronize it with upstream**

Run:

```bash
git status --short --branch
git fetch --prune origin
git rev-list --left-right --count origin/main...HEAD
```

Expected: only the committed design and plan are ahead of `origin/main`; the
worktree has no modified or untracked files.

If the branch is behind, run:

```bash
git rebase origin/main
git merge-base --is-ancestor origin/main HEAD
git status --short --branch
```

Expected: the rebase is conflict-free, the ancestry check exits 0, and the
worktree remains clean. Stop for scope review if upstream materially changed
the preflight reader, its fixture, or the target changelog history.

- [ ] **Step 2: Run the focused baseline before editing**

Run:

```bash
pnpm install --frozen-lockfile
node --test scripts/__tests__/publish-preflight.test.mjs scripts/__tests__/publish-public-packages.test.mjs
```

Expected: installation exits 0 without changing the lockfile. At the approved
baseline, 36 tests pass and 0 fail. If upstream adds tests, record the new
passing count rather than forcing the old count.

- [ ] **Step 3: Confirm the live incident shape without changing package state**

Run:

```bash
node --input-type=module <<'NODE'
const response = await fetch(
  "https://registry.npmjs.org/%40pretable%2fstream-adapter",
);
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const metadata = await response.json();
const active = new Set(Object.keys(metadata.versions ?? {}));
const historical = new Set(Object.keys(metadata.time ?? {}));
if (active.has("0.1.0") || !historical.has("0.1.0")) {
  throw new Error("Expected stream-adapter@0.1.0 to be historical-only");
}
console.log("confirmed historical-only @pretable/stream-adapter@0.1.0");
NODE
```

Expected: exit 0 and the confirmation line. A registry/network failure blocks
the live proof but not local test authoring; record it and retry before the
final gate.

### Task 2: Add packument fixtures and observe the tombstone regressions fail

Use `@superpowers:test-driven-development` for Tasks 2 and 3. Do not edit the
implementation before the required red run.

**Files:**

- Modify: `scripts/__tests__/publish-preflight.test.mjs:10-61`
- Modify: `scripts/__tests__/publish-preflight.test.mjs:157-289`
- Test: `scripts/__tests__/publish-preflight.test.mjs`

- [ ] **Step 1: Extend the local registry fixture to model `versions` and `time`**

Add these helpers above `createFixture`:

```js
function versionMap(versions, value) {
  return Object.fromEntries(versions.map((version) => [version, value]));
}

function registryMetadata(result) {
  if (Array.isArray(result)) {
    return { versions: versionMap(result, {}) };
  }

  const metadata = {
    versions: versionMap(result.versions ?? [], {}),
  };
  if (Object.hasOwn(result, "time")) {
    metadata.time = Array.isArray(result.time)
      ? versionMap(result.time, "2026-08-10T00:00:00.000Z")
      : result.time;
  }
  return metadata;
}
```

Replace the successful response body with:

```js
response.end(JSON.stringify(registryMetadata(result)));
```

Keep the array shorthand so every existing fixture still emits only a
`versions` object. Explicit objects opt into `time`, including malformed values.

- [ ] **Step 2: Add a failing aggregate tombstone regression**

Add this test near the other registry-state tests:

```js
test("rejects every withdrawn local package version in sorted order", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/stream-adapter", "0.1.0"),
      publicPackage("@pretable/core", "0.1.0"),
    ],
    registry: {
      "@pretable/stream-adapter": {
        versions: ["0.0.14", "0.2.0"],
        time: ["created", "modified", "0.1.0", "0.0.14", "0.2.0"],
      },
      "@pretable/core": {
        versions: ["0.0.14", "0.2.0"],
        time: ["created", "modified", "0.1.0", "0.0.14", "0.2.0"],
      },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /previously published/i);
      assert.match(error.message, /no longer active/i);
      assert.match(error.message, /cannot be reused/i);
      assert.match(error.message, /choose a new version/i);
      const coreIndex = error.message.indexOf("@pretable/core@0.1.0");
      const streamIndex = error.message.indexOf(
        "@pretable/stream-adapter@0.1.0",
      );
      assert.ok(coreIndex >= 0);
      assert.ok(streamIndex > coreIndex);
      return true;
    },
  );
});
```

The package input is intentionally not sorted. The assertion requires the
preflight to collect both violations and sort its output.

- [ ] **Step 3: Add the active, genuinely-new, and omitted-history characterization**

```js
test("distinguishes active and genuinely new local package versions", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/core", "0.3.1"),
      publicPackage("@pretable/ui", "0.3.2"),
    ],
    registry: {
      "@pretable/core": {
        versions: ["0.3.1"],
        time: ["created", "modified", "0.3.1"],
      },
      "@pretable/ui": ["0.3.1"],
    },
  });

  const result = await runPublishPreflight({ rootDir, registryUrl });

  assert.equal(result.publicPackageCount, 2);
  assert.equal(result.sameBatchPackageCount, 1);
});
```

This proves an active version wins even when it also appears in history, while
an inactive version from a registry that omits `time` preserves same-batch behavior.

- [ ] **Step 4: Add malformed-time and non-local historical dependency regressions**

```js
test("rejects malformed registry time metadata with package context", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [publicPackage("@pretable/core", "0.3.1")],
    registry: {
      "@pretable/core": { versions: ["0.3.1"], time: "invalid" },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/core/);
      assert.match(error.message, /registry metadata/i);
      assert.match(error.message, /time object/i);
      return true;
    },
  );
});

test("does not satisfy a non-local dependency from registry history", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.3.1", {
        dependencies: { "@pretable/ui": "0.1.0" },
      }),
    ],
    registry: {
      "@pretable/react": {
        versions: ["0.3.1"],
        time: ["0.3.1"],
      },
      "@pretable/ui": {
        versions: ["0.0.14"],
        time: ["0.0.14", "0.1.0"],
      },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/react/);
      assert.match(error.message, /@pretable\/ui/);
      assert.match(error.message, /0\.1\.0/);
      assert.match(error.message, /unavailable from the registry/i);
      assert.doesNotMatch(error.message, /previously published/i);
      return true;
    },
  );
});
```

The dependency is deliberately absent from the local workspace fixture. This
prevents the local-package tombstone guard from making the dependency test pass
for the wrong reason.

- [ ] **Step 5: Run the new tests against the old implementation and record RED**

Run:

```bash
node --test --test-name-pattern='withdrawn|active and genuinely new|malformed registry time|non-local dependency' scripts/__tests__/publish-preflight.test.mjs
```

Expected: the withdrawn-package test fails because the current code accepts the
versions as same-batch; the malformed-time test fails because current code
ignores `time`. The active/new and non-local dependency tests pass as
characterization tests. Do not implement until both intended failures are
observed and attributable to the missing registry-state model.

### Task 3: Implement the registry-state model and make release tests green

**Files:**

- Modify: `scripts/publish-preflight.mjs:151-239`
- Modify: `scripts/publish-preflight.mjs:277-370`
- Test: `scripts/__tests__/publish-preflight.test.mjs`
- Verify unchanged: `scripts/__tests__/publish-public-packages.test.mjs`

- [ ] **Step 1: Add one shared plain-object predicate**

Add near the validation helpers:

```js
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
```

Use it in `validateDependencyFields` in place of the repeated object-shape
conditions. This is the only validation refactor in scope.

- [ ] **Step 2: Replace `readRegistryVersions` with `readRegistryPackageState`**

Keep the existing request, timeout, HTTP, and JSON error handling. Change the
404 return to:

```js
return {
  activeVersions: new Set(),
  historicalVersions: new Set(),
};
```

After parsing JSON, validate and return state with this shape:

```js
if (!isPlainObject(metadata) || !isPlainObject(metadata.versions)) {
  throw new Error(
    `Registry metadata was invalid for ${packageName}: expected a versions object`,
  );
}
if (metadata.time !== undefined && !isPlainObject(metadata.time)) {
  throw new Error(
    `Registry metadata was invalid for ${packageName}: expected a time object`,
  );
}

return {
  activeVersions: new Set(Object.keys(metadata.versions)),
  historicalVersions: new Set(
    Object.keys(metadata.time ?? {}).filter((version) => semver.valid(version)),
  ),
};
```

Rename the function and its cache accessor consistently. Do not export the
reader or add a second registry request.

- [ ] **Step 3: Classify and reject historical-only local versions**

Replace same-batch discovery with:

```js
const sameBatchPackages = new Set();
const withdrawnPackages = [];
for (const workspacePackage of publicPackages) {
  const { name, version } = workspacePackage.manifest;
  const { activeVersions, historicalVersions } =
    await registryPackageState(name);
  if (activeVersions.has(version)) {
    continue;
  }
  if (historicalVersions.has(version)) {
    withdrawnPackages.push(`${name}@${version}`);
    continue;
  }
  sameBatchPackages.add(`${name}@${version}`);
}

if (withdrawnPackages.length > 0) {
  throw new Error(
    `Publish version preflight failed:\n${withdrawnPackages
      .sort()
      .map(
        (packageVersion) =>
          `- ${packageVersion} was previously published and is no longer active; published versions cannot be reused. Choose a new version.`,
      )
      .join("\n")}`,
  );
}
```

The rejection must occur before dependency validation. Do not silently skip the
package or let Changesets decide.

- [ ] **Step 4: Restrict dependency satisfaction to active versions**

Replace the dependency lookup with:

```js
const { activeVersions } = await registryPackageState(dependencyName);
if (
  [...activeVersions].some((version) =>
    semver.satisfies(version, normalizedSpec),
  )
) {
  registrySatisfiedEdgeCount += 1;
  continue;
}
```

Never combine `historicalVersions` with this set. Same-batch fallback remains
unchanged after the active registry check.

- [ ] **Step 5: Run the focused release tests and confirm GREEN**

Run:

```bash
pnpm exec prettier --write scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs
pnpm exec eslint scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs --no-warn-ignored
node --test scripts/__tests__/publish-preflight.test.mjs scripts/__tests__/publish-public-packages.test.mjs
```

Expected: direct script lint exits 0. At the approved baseline, 40 tests pass,
0 fail. The existing
`does not publish when the preflight rejects` wrapper test remains green.

- [ ] **Step 6: Run two negative controls, restoring intended code after each**

First, temporarily bypass the `historicalVersions.has(version)` branch with an
`apply_patch` edit and rerun the withdrawn-package test. Expected: it fails
because no rejection occurs. Restore the intended branch with `apply_patch`,
rerun, and require a pass.

Second, temporarily satisfy dependencies from the union of active and
historical sets and rerun the non-local dependency test. Expected: it fails
because `0.1.0` is incorrectly accepted. Restore active-only lookup with
`apply_patch`, rerun, and require a pass.

Run after restoration:

```bash
node --test --test-name-pattern='withdrawn|non-local dependency' scripts/__tests__/publish-preflight.test.mjs
git diff --check
```

Expected: both tests pass and the diff check exits 0. Inspect the dependency
branch directly to confirm only `activeVersions` participates.

- [ ] **Step 7: Commit the tested release guard**

Run:

```bash
git add -- scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs
git diff --cached --check
git diff --cached --stat
git commit -m "fix: reject tombstoned package versions"
```

Expected: the commit contains only the preflight implementation and its tests.

### Task 4: Correct the stream-adapter release history

**Files:**

- Modify: `packages/stream-adapter/CHANGELOG.md:3-72`
- Verify: `packages/stream-adapter/package.json`

- [ ] **Step 1: Remove the duplicate empty heading and document `0.1.1`**

Change:

```markdown
## 0.1.1

## 0.1.0
```

to:

```markdown
## 0.1.1

This version was assigned in the repository but was never published. The next
published `@pretable/stream-adapter` version was `0.2.0`.
```

Leave the later historical `0.1.0` heading and its feature notes in place.

- [ ] **Step 2: Remove the stale blockquote and correct `0.1.0`**

Delete the blockquote after `0.0.4` that claims `0.1.0` remains as a
deprecated registry release. Replace the sentence below the remaining
`## 0.1.0` heading with:

```markdown
This version was published to npm in error and then withdrawn. It is no longer
installable, and npm permanently reserves the version so it cannot be reused.
`0.0.3` carries the same code.
```

Do not rewrite generated feature or dependency notes.

- [ ] **Step 3: Verify the history and artifact boundary**

Run:

```bash
pnpm exec prettier --write packages/stream-adapter/CHANGELOG.md
test "$(rg -c '^## 0\.1\.0$' packages/stream-adapter/CHANGELOG.md)" -eq 1
rg -n 'never published|withdrawn|cannot be reused' packages/stream-adapter/CHANGELOG.md
rg -n 'published .*0\.2\.0' packages/stream-adapter/CHANGELOG.md
if rg -n 'stays on the registry|deprecated release|first delivered' packages/stream-adapter/CHANGELOG.md; then exit 1; fi
node -e 'const manifest=require("./packages/stream-adapter/package.json"); if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) process.exit(1)'
git diff --check
git diff --name-only origin/main...HEAD -- .changeset
```

Expected: one `0.1.0` heading; factual phrases present; stale phrases absent;
`files` remains `["dist"]`; the branch adds no Changeset.

- [ ] **Step 4: Commit the historical correction**

Run:

```bash
git add -- packages/stream-adapter/CHANGELOG.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: correct stream adapter release history"
```

Expected: the commit contains only the changelog correction.

### Task 5: Run the complete release-hardening gate

Use `@superpowers:verification-before-completion`. Run every command fresh and
independently; a passing focused test does not substitute for a root gate.

**Files:**

- Verify all branch changes
- Do not modify source during this task

- [ ] **Step 1: Refresh upstream ancestry before the expensive gate**

Run:

```bash
git fetch --prune origin
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean worktree, ancestry exit 0, behind count 0. If main advanced,
rebase the unpushed branch, then restart Task 5 so evidence applies to the final
commit graph.

- [ ] **Step 2: Reconfirm regressions and the live tombstone signal**

Run:

```bash
node --test scripts/__tests__/publish-preflight.test.mjs scripts/__tests__/publish-public-packages.test.mjs
node --input-type=module <<'NODE'
const response = await fetch(
  "https://registry.npmjs.org/%40pretable%2fstream-adapter",
);
if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
const metadata = await response.json();
const active = new Set(Object.keys(metadata.versions ?? {}));
const historical = new Set(Object.keys(metadata.time ?? {}));
if (active.has("0.1.0") || !historical.has("0.1.0")) {
  throw new Error("Expected stream-adapter@0.1.0 to be historical-only");
}
console.log("confirmed historical-only @pretable/stream-adapter@0.1.0");
NODE
```

Expected: 40/40 focused tests at the approved baseline and live confirmation.
Record an upstream-adjusted passing count if needed.

- [ ] **Step 3: Run every root gate independently**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm exec eslint scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs --no-warn-ignored
pnpm build
pnpm api:check
pnpm lint:packaging
pnpm publish:preflight
pnpm format
git diff --check
git diff origin/main...HEAD --check
```

Expected: every command exits 0. Record exact test totals and distinguish known
baseline warnings from new warnings. The preflight must inspect current active
workspace versions without invoking publication.

- [ ] **Step 4: Prove the branch creates no package release and document Changesets' package-path heuristic**

```bash
(
  set -eu
  pnpm exec changeset status
  if changeset_status_output="$(pnpm exec changeset status --since=origin/main 2>&1)"; then
    changeset_status_exit=0
  else
    changeset_status_exit=$?
  fi
  printf '%s\n' "$changeset_status_output"
  test "$changeset_status_exit" -eq 1
  printf '%s\n' "$changeset_status_output" | rg -F 'Some packages have been changed but no changesets were found'
  printf '%s\n' "$changeset_status_output" | rg -F 'changeset add --empty'
  test -z "$(git diff --name-only origin/main...HEAD -- .changeset)"
  test "$(git diff --name-only origin/main...HEAD -- apps packages)" = 'packages/stream-adapter/CHANGELOG.md'
  node -e 'const manifest=require("./packages/stream-adapter/package.json"); if (JSON.stringify(manifest.files) !== JSON.stringify(["dist"])) process.exit(1)'
)
```

Expected: plain status exits 0 and lists only unrelated upstream release intent.
The captured branch-relative status exits 1 with both asserted diagnostics
because Changesets classifies the package-local changelog as a package change.
The `.changeset` diff is empty, the changelog is the only branch change anywhere
under `apps` or `packages`, and the manifest publishes exactly `["dist"]`.
Together these fail-fast checks prove that the branch creates no package release
despite the expected package-path heuristic.

- [ ] **Step 5: Audit final scope and repository hygiene**

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: clean worktree; only the approved design, plan, preflight script,
preflight tests, and stream-adapter changelog differ. No package manifest,
lockfile, workflow, runtime source, generated artifact, or Changeset changed.

### Task 6: Review and publish the release-hardening pull request

Use `@superpowers:requesting-code-review` before publication and
`@github:yeet` for the GitHub handoff.

**Files:**

- Review: every file in `git diff origin/main...HEAD`
- Do not add unrelated fixes during review

- [ ] **Step 1: Request one independent implementation review**

Provide only the spec path, plan path, exact commit range, and verification
evidence. Require Critical/Important/Minor findings covering:

- active versus historical registry semantics;
- 404, omitted `time`, and malformed `time` behavior;
- deterministic multi-package rejection;
- dependency resolution from active versions only;
- test red/green validity and negative controls;
- changelog accuracy and no-Changeset justification;
- scope and compatibility with the publish wrapper.

Expected: no unresolved Critical or Important findings. Address valid findings
test-first, rerun affected and full gates, and request re-review.

- [ ] **Step 2: Push and open a draft PR**

Before pushing, run:

```bash
git fetch --prune origin
git merge-base --is-ancestor origin/main HEAD
git status --short --branch
git diff origin/main...HEAD --check
```

Expected: current upstream is an ancestor, the worktree is clean, and the diff
check exits 0.

Push `agent/release-preflight-tombstones` and open a draft pull request with:

- a concise root-cause summary;
- the active/history classification table;
- explicit no-Changeset rationale;
- focused RED/GREEN and negative-control evidence;
- full verification results;
- the live registry proof;
- no claim that `0.1.1` was published or that code first appeared in `0.2.0`.

- [ ] **Step 3: Monitor initial checks and report the handoff**

Report the PR link, head SHA, exact file scope, current check state, and any
warnings or blockers. Do not merge or convert the draft without explicit
authorization.
