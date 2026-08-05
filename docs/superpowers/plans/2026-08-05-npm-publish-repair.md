# npm Publish Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill the three missing historical npm releases, remove the release skip that caused the outage, and prevent future public packages from depending on unavailable `@pretable/*` versions.

**Architecture:** A testable Node preflight discovers public workspace manifests, queries registry metadata, derives the exact same-publish batch, and validates every non-development `@pretable/*` dependency with semantic-version matching. The release wrapper runs that preflight before unmodified Changesets publishing. Historical artifacts are built from the version commit in a detached temporary worktree, inspected, published in dependency order, and validated from a registry-only clean consumer project.

**Tech Stack:** Node.js 22 ESM, `node:test`, `semver`, pnpm workspaces, Changesets, GitHub Actions, npm registry.

---

## File Structure

- Create `scripts/publish-preflight.mjs`: workspace discovery, registry client, dependency-spec normalization, validation, and CLI entrypoint.
- Create `scripts/__tests__/publish-preflight.test.mjs`: deterministic temporary workspaces and local HTTP registry fixtures.
- Create `scripts/publish-public-packages.mjs`: side-effect-free orchestration that composes preflight with Changesets publishing.
- Create `scripts/__tests__/publish-public-packages.test.mjs`: verifies preflight precedes Changesets and publish failures propagate.
- Modify `scripts/publish-configured-packages.mjs`: remove manifest mutation and delegate direct execution to the tested orchestration module.
- Modify `package.json`: add the preflight command, include its tests in the root test command, and add `semver`.
- Modify `pnpm-lock.yaml`: lock the direct `semver` development dependency.
- Modify `.github/workflows/ci.yml`: add the registry-backed publish-preflight CI job and make deployment depend on it.
- Modify `.github/workflows/release.yml`: run all public-package packaging checks and the preflight before the Changesets action.

### Task 1: Specify publish-preflight behavior with failing tests

**Files:**

- Create: `scripts/__tests__/publish-preflight.test.mjs`
- Test target: `scripts/publish-preflight.mjs`

- [ ] **Step 1: Write fixture helpers**

Use temporary directories to create minimal `packages/*/package.json` workspaces and an in-process HTTP server that returns npm-style `{ versions: { "1.2.3": {} } }` metadata, 404s, or 500s. Do not contact the public registry in unit tests.

- [ ] **Step 2: Write the core failing cases**

Import `runPublishPreflight` and assert:

```js
await assert.doesNotReject(() => runPublishPreflight({ rootDir, registryUrl }));

await assert.rejects(
  () => runPublishPreflight({ rootDir, registryUrl }),
  /@pretable\/react.*@pretable\/ui.*0\.0\.2/,
);
```

Cover registry hits, missing versions, registry errors, and a non-private local name/version absent from the registry that is accepted as part of the same batch.

- [ ] **Step 3: Write dependency-kind and specification cases**

Cover `dependencies`, `optionalDependencies`, and `peerDependencies`; prove `devDependencies` are ignored. Cover exact versions, ranges, `workspace:*`, `workspace:^`, and `workspace:~`. Reject unsupported `file:`, `link:`, git, URL, and npm-alias protocols with an actionable error. Reject every dependency whose name matches a private local workspace package, including workspace, exact, and range specifications, even when the registry contains a satisfying public version.

- [ ] **Step 4: Run the focused test and verify RED**

Run: `node --test scripts/__tests__/publish-preflight.test.mjs`

Expected: FAIL because `scripts/publish-preflight.mjs` does not exist.

- [ ] **Step 5: Commit the failing specification**

```bash
git add scripts/__tests__/publish-preflight.test.mjs
git commit -m "test: specify publish dependency preflight"
```

### Task 2: Implement the registry-aware preflight

**Files:**

- Create: `scripts/publish-preflight.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `scripts/__tests__/publish-preflight.test.mjs`

- [ ] **Step 1: Add semantic-version support**

Run: `pnpm add --save-dev --workspace-root semver`

Expected: `semver` appears in root `devDependencies` and the lockfile changes only as required.

- [ ] **Step 2: Implement workspace discovery and registry metadata reads**

Export focused functions and the orchestration entrypoint:

```js
export async function discoverWorkspacePackages(rootDir) {}
export function normalizeDependencySpec(spec, localPackage) {}
export async function runPublishPreflight(options = {}) {}
```

Discover `apps/*/package.json` and `packages/*/package.json`, cache registry metadata per package name, treat registry 404 as no versions, and treat network/non-404 failures as fatal.

- [ ] **Step 3: Derive the same-batch set**

For each non-private local package, query whether its exact name/version exists. Treat each missing exact pair as publishable in the imminent Changesets batch. Never include private packages.

- [ ] **Step 4: Validate non-development Pretable dependencies**

For every public package, inspect `dependencies`, `optionalDependencies`, and `peerDependencies`. Before registry or batch satisfaction checks, unconditionally reject any dependency name matching a private local workspace package. Normalize workspace specifications against the matching local version. Use `semver.satisfies` against registry versions and the exact same-batch version. Accumulate all violations so one run reports every broken edge.

- [ ] **Step 5: Add the CLI**

When invoked directly, use `NPM_CONFIG_REGISTRY`, `npm_config_registry`, or `https://registry.npmjs.org` and print a compact success summary containing public package count, dependency edge count, registry-satisfied edge count, and same-batch edge count. On failure, print the actionable errors and exit nonzero.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `node --test scripts/__tests__/publish-preflight.test.mjs`

Expected: all fixture cases PASS.

- [ ] **Step 7: Run formatting and focused lint checks**

Run: `pnpm exec prettier --check scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs package.json`

Run: `pnpm exec eslint scripts/publish-preflight.mjs scripts/__tests__/publish-preflight.test.mjs`

Expected: both exit 0.

- [ ] **Step 8: Commit the implementation**

```bash
git add scripts/publish-preflight.mjs package.json pnpm-lock.yaml
git commit -m "feat: validate publish dependency availability"
```

### Task 3: Put the preflight in every release path

**Files:**

- Create: `scripts/__tests__/publish-public-packages.test.mjs`
- Create: `scripts/publish-public-packages.mjs`
- Modify: `scripts/publish-configured-packages.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write a failing wrapper-order test**

Import a new, currently absent side-effect-free module. Do not import the existing wrapper during RED because its current top-level code mutates manifests and starts publishing. Expected API:

```js
await publishConfiguredPackages({
  preflight: async () => events.push("preflight"),
  spawnPublish: async () => events.push("publish"),
});
assert.deepEqual(events, ["preflight", "publish"]);
```

Also assert a preflight rejection prevents publish and a nonzero Changesets exit rejects.

- [ ] **Step 2: Run the wrapper test and verify RED**

Run: `node --test scripts/__tests__/publish-public-packages.test.mjs`

Expected: FAIL safely because `scripts/publish-public-packages.mjs` does not exist. No existing release script is imported or executed.

- [ ] **Step 3: Replace the skip wrapper**

Implement `publishConfiguredPackages` in the new side-effect-free module, call `runPublishPreflight` first, then run `pnpm exec changeset publish` with inherited stdio and faithful signal/exit propagation. Replace the existing wrapper's manifest reads/writes and skipped-package list with a direct call to that orchestration function.

- [ ] **Step 4: Wire package scripts and root tests**

Add `"publish:preflight": "node ./scripts/publish-preflight.mjs"`. Add both new `node:test` files to the root `test` command so they run in normal CI.

- [ ] **Step 5: Add the CI guard**

Add a `publish-preflight` job to `.github/workflows/ci.yml` that installs with the frozen lockfile and runs `pnpm publish:preflight`. Add it to production and preview deployment `needs` lists.

- [ ] **Step 6: Harden the release workflow**

Replace the three-package packaging filter with `pnpm lint:packaging`, which already covers all five public packages. Add an explicit `pnpm publish:preflight` step before the Changesets action; the wrapper repeats it immediately before publishing to close time/configuration gaps.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `node --test scripts/__tests__/publish-preflight.test.mjs scripts/__tests__/publish-public-packages.test.mjs`

Run: `pnpm publish:preflight`

Expected: fixture tests PASS; live preflight reports React's UI dependency as a same-batch edge before the backfill.

- [ ] **Step 8: Commit pipeline integration**

```bash
git add scripts/publish-public-packages.mjs scripts/publish-configured-packages.mjs scripts/__tests__/publish-public-packages.test.mjs package.json .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: guard public package publishing"
```

### Task 4: Verify current package artifacts and repository health

**Files:** No intended source changes.

- [ ] **Step 1: Build all packages and applications**

Run: `pnpm build`

Expected: exit 0.

- [ ] **Step 2: Run all public packaging checks**

Run: `pnpm lint:packaging`

Expected: publint and package type checks pass for core, react, json-stream, stream-adapter, and UI.

- [ ] **Step 3: Inspect the current UI pack surface**

Run `pnpm --filter @pretable/ui pack --pack-destination <temporary-artifact-dir>`, list the tarball, and inspect its packed manifest. Confirm all four required CSS files and declaration files exist and every documented export targets a packed file.

- [ ] **Step 4: Run repository verification**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`

Expected: all commands exit 0 with zero test failures.

- [ ] **Step 5: Commit any formatting-only corrections if needed**

```bash
git add <only-files-formatted-by-the-task>
git commit -m "style: format publish guard"
```

Skip this commit when no files changed.

### Task 5: Build and inspect the historical backfill artifacts

**Files:** No tracked source changes; use a detached temporary worktree and an artifact directory outside the repository.

Run every command in Tasks 5 and 6 in one named persistent shell session so `release_root`, `historical_worktree`, `artifact_dir`, package publish flags, and `public_registry` remain defined. Print and record all absolute paths immediately. If the session is lost, stop and recover the recorded paths before running another command; never continue with empty variables.

- [ ] **Step 1: Create a detached historical worktree**

From the release-fix worktree, create unique source and artifact directories and run:

```bash
release_root=$(mktemp -d /tmp/pretable-backfill.XXXXXX)
historical_worktree="$release_root/source"
artifact_dir="$release_root/artifacts"
set -euo pipefail
mkdir -p "$artifact_dir"
git worktree add --detach "$historical_worktree" 3228771e4e2887656729dff2dbc3d7f004649cfb
git -C "$historical_worktree" rev-parse HEAD
```

Expected commit: `3228771e4e2887656729dff2dbc3d7f004649cfb`.

- [ ] **Step 2: Install and build the historical packages**

Run:

```bash
pnpm --dir "$historical_worktree" install --frozen-lockfile
pnpm --dir "$historical_worktree" --filter @cacheplane/json-stream build
pnpm --dir "$historical_worktree" --filter @pretable/ui build
pnpm --dir "$historical_worktree" --filter @pretable/stream-adapter build
```

Expected: all four commands exit 0.

- [ ] **Step 3: Pack into a separate artifact directory**

Run:

```bash
pnpm --dir "$historical_worktree" --filter @cacheplane/json-stream pack --pack-destination "$artifact_dir"
pnpm --dir "$historical_worktree" --filter @pretable/ui pack --pack-destination "$artifact_dir"
pnpm --dir "$historical_worktree" --filter @pretable/stream-adapter pack --pack-destination "$artifact_dir"
ls -lh "$artifact_dir"/*.tgz
shasum -a 512 "$artifact_dir"/*.tgz
```

Expected tarballs: `cacheplane-json-stream-0.0.2.tgz`, `pretable-ui-0.0.2.tgz`, and `pretable-stream-adapter-0.1.0.tgz`.

- [ ] **Step 4: Validate every packed manifest**

List and extract without modifying the tarballs:

```bash
for archive in "$artifact_dir"/*.tgz; do
  tar -tf "$archive"
  tar -xOf "$archive" package/package.json
done
```

Run this executable assertion:

```bash
node --input-type=module - "$artifact_dir" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const artifactDir = process.argv[2];
const expected = new Map([
  ["cacheplane-json-stream-0.0.2.tgz", ["@cacheplane/json-stream", "0.0.2"]],
  ["pretable-ui-0.0.2.tgz", ["@pretable/ui", "0.0.2"]],
  ["pretable-stream-adapter-0.1.0.tgz", ["@pretable/stream-adapter", "0.1.0"]],
]);

function exportTargets(value) {
  if (typeof value === "string") return [value];
  return Object.values(value ?? {}).flatMap(exportTargets);
}

for (const [filename, [name, version]] of expected) {
  const archive = join(artifactDir, filename);
  const files = new Set(
    execFileSync("tar", ["-tf", archive], { encoding: "utf8" })
      .trim()
      .split("\n"),
  );
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOf", archive, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  assert.equal(manifest.name, name);
  assert.equal(manifest.version, version);
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.license, "MIT");
  assert.ok(manifest.repository?.url);
  for (const group of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    for (const spec of Object.values(group ?? {})) {
      assert.ok(!spec.startsWith("workspace:"), `${name}: ${spec}`);
    }
  }
  for (const target of exportTargets(manifest.exports)) {
    const packedPath = `package/${target.replace(/^\.\//, "")}`;
    assert.ok(files.has(packedPath), `${name}: missing ${packedPath}`);
  }
  if (name === "@pretable/ui") {
    const cssExports = {
      "./themes/excel.css": {
        types: "./dist/themes/excel.css.d.ts",
        default: "./dist/themes/excel.css",
      },
      "./themes/material.css": {
        types: "./dist/themes/material.css.d.ts",
        default: "./dist/themes/material.css",
      },
      "./grid.css": {
        types: "./dist/grid.css.d.ts",
        default: "./dist/grid.css",
      },
      "./tailwind.css": {
        types: "./dist/tailwind.css.d.ts",
        default: "./dist/tailwind.css",
      },
    };
    for (const [key, value] of Object.entries(cssExports)) {
      assert.deepEqual(manifest.exports[key], value, `${name}: ${key}`);
    }
  }
  if (name === "@pretable/stream-adapter") {
    assert.equal(manifest.dependencies?.["@cacheplane/json-stream"], "0.0.2");
  }
}
NODE
```

The direct publish command will supply `--access public` because these historical manifests have no `publishConfig`. Any failed assertion aborts before publication.

- [ ] **Step 5: Validate the UI CSS contract**

Run:

```bash
ui_tarball="$artifact_dir/pretable-ui-0.0.2.tgz"
ui_files=$(tar -tf "$ui_tarball")
for required in \
  package/dist/themes/excel.css \
  package/dist/themes/excel.css.d.ts \
  package/dist/themes/material.css \
  package/dist/themes/material.css.d.ts \
  package/dist/grid.css \
  package/dist/grid.css.d.ts \
  package/dist/tailwind.css \
  package/dist/tailwind.css.d.ts; do
  printf '%s\n' "$ui_files" | rg -x "$required" >/dev/null || exit 1
done
```

The Task 5 Step 4 Node assertion explicitly requires the four export-map keys and their exact `types` and `default` targets. Expected: every command exits 0.

- [ ] **Step 6: Remove the detached worktree safely**

Run `git worktree remove "$historical_worktree"` from the release-fix worktree after the artifacts and hashes are recorded. Retain `$artifact_dir` until registry publication and clean-install verification finish.

### Task 6: Publish the historical backfill in dependency order

**Files:** External npm registry state only.

- [ ] **Step 1: Reconfirm authentication and registry absence**

Continue in the named persistent shell session from Task 5. Use only the explicit public registry:

```bash
public_registry=https://registry.npmjs.org
npm whoami --registry="$public_registry"
npm view @cacheplane/json-stream versions dist-tags --json --registry="$public_registry"
npm view @pretable/ui versions dist-tags --json --registry="$public_registry"
npm view @pretable/stream-adapter versions dist-tags --json --registry="$public_registry"
```

Define executable tag and exact-version race guards:

```bash
registry_artifact_dir="$release_root/registry"
mkdir -p "$registry_artifact_dir"

assert_target_safe() {
  package_name="$1"
  target_version="$2"
  error_file="$release_root/npm-view-error.log"
  if metadata=$(npm view "$package_name" --json --registry="$public_registry" 2>"$error_file"); then
    METADATA="$metadata" TARGET_VERSION="$target_version" node --input-type=module -e '
      import semver from "semver";
      const metadata = JSON.parse(process.env.METADATA);
      const target = process.env.TARGET_VERSION;
      const versions = Array.isArray(metadata.versions) ? metadata.versions : [];
      const newer = versions.filter((version) => semver.gt(version, target));
      if (newer.length > 0) throw new Error(`newer versions exist: ${newer.join(", ")}`);
      const latest = metadata["dist-tags"]?.latest;
      if (latest && semver.gt(latest, target)) {
        throw new Error(`publishing ${target} would move latest backward from ${latest}`);
      }
    '
  elif rg -q 'E404' "$error_file"; then
    return 0
  else
    sed -n '1,120p' "$error_file"
    return 1
  fi
}

check_exact_or_mark_publish() {
  package_name="$1"
  target_version="$2"
  local_tarball="$3"
  flag_name="$4"
  error_file="$release_root/npm-view-error.log"
  assert_target_safe "$package_name" "$target_version" || return 1
  if npm view "$package_name@$target_version" version --json --registry="$public_registry" >"$release_root/existing-version.json" 2>"$error_file"; then
    npm pack "$package_name@$target_version" --pack-destination "$registry_artifact_dir" --registry="$public_registry"
    registry_tarball="$registry_artifact_dir/$(basename "$local_tarball")"
    shasum -a 512 "$local_tarball" "$registry_tarball"
    cmp -s "$local_tarball" "$registry_tarball" || {
      echo "Immutable-version conflict for $package_name@$target_version"
      return 1
    }
    diff -u \
      <(tar -xOf "$local_tarball" package/package.json) \
      <(tar -xOf "$registry_tarball" package/package.json) || return 1
    printf -v "$flag_name" '%s' false
  elif rg -q 'E404' "$error_file"; then
    printf -v "$flag_name" '%s' true
  else
    sed -n '1,120p' "$error_file"
    return 1
  fi
}

check_exact_or_mark_publish \
  @cacheplane/json-stream 0.0.2 \
  "$artifact_dir/cacheplane-json-stream-0.0.2.tgz" publish_json_stream || exit 1
check_exact_or_mark_publish \
  @pretable/ui 0.0.2 \
  "$artifact_dir/pretable-ui-0.0.2.tgz" publish_ui || exit 1
check_exact_or_mark_publish \
  @pretable/stream-adapter 0.1.0 \
  "$artifact_dir/pretable-stream-adapter-0.1.0.tgz" publish_stream_adapter || exit 1
```

Expected: each flag is exactly `true` for a missing version or `false` for a byte-identical existing artifact. Any newer version, tag regression, registry error, SHA-512 mismatch, or manifest difference aborts the entire release before dependents are published.

- [ ] **Step 2: Publish json-stream first**

Run:

```bash
check_exact_or_mark_publish \
  @cacheplane/json-stream 0.0.2 \
  "$artifact_dir/cacheplane-json-stream-0.0.2.tgz" publish_json_stream || exit 1
if [ "$publish_json_stream" = true ]; then
  assert_target_safe @cacheplane/json-stream 0.0.2 && \
    npm publish "$artifact_dir/cacheplane-json-stream-0.0.2.tgz" --access public --registry="$public_registry" || exit 1
fi
```

Immediately verify:

```bash
npm view @cacheplane/json-stream@0.0.2 version dependencies dist.integrity --json --registry="$public_registry"
```

- [ ] **Step 3: Publish UI**

Run:

```bash
check_exact_or_mark_publish \
  @pretable/ui 0.0.2 \
  "$artifact_dir/pretable-ui-0.0.2.tgz" publish_ui || exit 1
if [ "$publish_ui" = true ]; then
  assert_target_safe @pretable/ui 0.0.2 && \
    npm publish "$artifact_dir/pretable-ui-0.0.2.tgz" --access public --registry="$public_registry" || exit 1
fi
npm view @pretable/ui@0.0.2 version exports dist.integrity --json --registry="$public_registry"
```

Expected: version 0.0.2 and all four CSS exports appear.

- [ ] **Step 4: Publish stream-adapter last**

Run only after json-stream is visible:

```bash
check_exact_or_mark_publish \
  @pretable/stream-adapter 0.1.0 \
  "$artifact_dir/pretable-stream-adapter-0.1.0.tgz" publish_stream_adapter || exit 1
if [ "$publish_stream_adapter" = true ]; then
  assert_target_safe @pretable/stream-adapter 0.1.0 && \
    npm publish "$artifact_dir/pretable-stream-adapter-0.1.0.tgz" --access public --registry="$public_registry" || exit 1
fi
npm view @pretable/stream-adapter@0.1.0 version dependencies dist.integrity --json --registry="$public_registry"
```

Expected dependency: `@cacheplane/json-stream: 0.0.2`.

- [ ] **Step 5: Re-run the live preflight**

Run: `pnpm publish:preflight`

Expected: all relevant dependency edges are satisfied by registry versions; no missing same-batch edge remains for React → UI.

### Task 7: Prove registry-only consumption from a clean directory

**Files:** Temporary files outside the repository only.

Run all Task 7 commands in a second named persistent shell session so `proof_dir` remains defined. Print and record its absolute path immediately. If the session is lost, stop and recover that exact path before continuing.

- [ ] **Step 1: Create the clean consumer project**

Create a unique directory, isolated npm configuration, and empty project:

```bash
proof_dir=$(mktemp -d /tmp/pretable-consumer.XXXXXX)
touch "$proof_dir/empty-npmrc"
pnpm --dir "$proof_dir" init
test ! -e "$proof_dir/.npmrc"
NPM_CONFIG_USERCONFIG="$proof_dir/empty-npmrc" pnpm --dir "$proof_dir" config get registry
```

Expected registry: `https://registry.npmjs.org/`. Confirm `git -C "$proof_dir" rev-parse --is-inside-work-tree` fails so the project is outside every repository worktree.

- [ ] **Step 2: Install exact versions with no overrides**

Run:

```bash
NPM_CONFIG_USERCONFIG="$proof_dir/empty-npmrc" \
NPM_CONFIG_REGISTRY=https://registry.npmjs.org \
pnpm --dir "$proof_dir" add \
  @pretable/core@0.0.2 \
  @pretable/react@0.0.2 \
  @pretable/ui@0.0.2 \
  @pretable/stream-adapter@0.1.0 \
  @cacheplane/json-stream@0.0.2 \
  react@19 \
  react-dom@19 \
  --registry=https://registry.npmjs.org
```

Expected: install exits 0 with no overrides, links, or workspace configuration.

- [ ] **Step 3: Write and run the import proof**

Use `apply_patch` to create `$proof_dir/verify.mjs` with this content after substituting the resolved absolute temporary path:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { createGrid } from "@pretable/core";
import { Pretable, PretableSurface } from "@pretable/react";
import { getDensityHeights } from "@pretable/ui";
import { createBatcher } from "@pretable/stream-adapter";
import { create } from "@cacheplane/json-stream";

for (const exported of [
  createGrid,
  Pretable,
  PretableSurface,
  getDensityHeights,
  createBatcher,
  create,
]) {
  assert.equal(typeof exported, "function");
}

const require = createRequire(import.meta.url);
for (const specifier of [
  "@pretable/ui/themes/excel.css",
  "@pretable/ui/themes/material.css",
  "@pretable/ui/grid.css",
  "@pretable/ui/tailwind.css",
]) {
  const resolved = require.resolve(specifier);
  assert.ok(existsSync(resolved), `${specifier} -> ${resolved}`);
  console.log(`${specifier} -> ${resolved}`);
}

const expectedVersions = new Map([
  ["@pretable/core", "0.0.2"],
  ["@pretable/react", "0.0.2"],
  ["@pretable/ui", "0.0.2"],
  ["@pretable/stream-adapter", "0.1.0"],
  ["@cacheplane/json-stream", "0.0.2"],
]);

function readInstalledManifest(name) {
  let directory = dirname(require.resolve(name));
  while (directory !== parse(directory).root) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      if (manifest.name === name) return manifest;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package.json for ${name}`);
}

for (const [name, version] of expectedVersions) {
  const manifest = readInstalledManifest(name);
  assert.equal(manifest.version, version, name);
  console.log(`${manifest.name}@${manifest.version}`);
}
```

Run: `node "$proof_dir/verify.mjs"`

Expected: exit 0 and all five package checks plus four CSS paths print.

- [ ] **Step 4: Audit the lockfile**

Run:

```bash
if rg -n 'workspace:|link:|file:|patch:|overrides:|/Users/blove/repos/pretable' "$proof_dir/pnpm-lock.yaml" "$proof_dir/package.json"; then
  echo "Local or overridden resolution found"
  exit 1
fi
test ! -e "$proof_dir/pnpm-workspace.yaml"
test ! -e "$proof_dir/.npmrc"
node "$proof_dir/verify.mjs"
```

Expected: the search produces no matches, configuration assertions pass, and the import proof prints exact requested package versions.

- [ ] **Step 5: Capture proof output and remove the temporary project**

Record install output, import output, and the temporary path for the final report, then remove the temporary consumer directory with `rm -r "$proof_dir"` only after evidence is captured and the variable is verified to begin with `/tmp/pretable-consumer.`.

### Task 8: Final review and delivery

**Files:** All task changes.

- [ ] **Step 1: Review the diff and commit history**

Run `git status --short`, `git diff origin/main...HEAD --check`, and `git log --oneline origin/main..HEAD`. Confirm no generated artifacts, credentials, `.env`, or temporary paths are tracked.

- [ ] **Step 2: Run fresh final verification**

Run:

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm lint:packaging
pnpm publish:preflight
```

Expected: every command exits 0; report exact test totals and preflight summary from this fresh run.

- [ ] **Step 3: Request independent code review**

Use `superpowers:requesting-code-review` with the objective, design, plan, diff, and verification evidence. Address only concrete correctness issues and re-run affected verification.

- [ ] **Step 4: Report the outcome**

Report the root cause, exact published names/versions and integrity hashes, UI CSS export proof, clean-install/import output, preflight behavior and CI locations, commits, and any remaining external follow-up such as trusted-publisher configuration for newly created npm packages.
