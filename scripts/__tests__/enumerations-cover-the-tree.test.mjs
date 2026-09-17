import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * **The invariant: no hand-written list decides what gets checked.**
 *
 * Two of this repo's quality gates were driven by a list someone had to
 * remember to extend, and both had silently stopped covering part of the tree.
 *
 * 1. **Lint.** `@pretable/app-website`'s script was `eslint app content`, so
 *    `e2e`, `lib`, `__tests__`, `scripts` and `types` — 38 spec files among
 *    them — were never linted. `@pretable/app-bench` listed `src` and skipped
 *    `tests`. Nothing announced the hole: `eslint app content` exits 0 and
 *    prints the same "clean" as a run that checked everything. Widening the
 *    scripts surfaced two real errors immediately, one of them a computed test
 *    control that was never asserted on.
 *
 * 2. **Contract tests.** The root `test` script names each
 *    `scripts/__tests__/*.test.mjs` file individually, and
 *    `bench-row-model-gate` and `bench-row-model-memory` — 9 assertions — had
 *    never been added to it. They passed when run by hand; they simply were
 *    not run.
 *
 * Both holes share a shape: the enumeration and the thing enumerated drift
 * apart, and the gate reports success the whole time. This guard removes the
 * drift by deriving both lists from the tree.
 *
 * **Why `eslint .` rather than a longer list of folders.** A list of folders
 * is the same defect one edit later. Linting the package root covers a folder
 * the day it appears, and the generated trees it would otherwise walk are
 * excluded once, centrally, in `eslint.config.js`'s `ignores` — which is also
 * the only place that knowledge belongs.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The one lint command every workspace package must run. */
const EXPECTED_LINT = "eslint .";

/**
 * Every workspace package directory, discovered rather than listed, so a
 * package added tomorrow is covered with no edit here.
 */
function workspacePackageDirs() {
  return ["apps", "packages"].flatMap((group) => {
    const groupDir = join(REPO_ROOT, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(groupDir, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")));
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("every workspace package lints its whole directory", () => {
  const offenders = [];
  for (const dir of workspacePackageDirs()) {
    const manifest = readJson(join(dir, "package.json"));
    const lint = manifest.scripts?.lint;
    // A package with no lint script at all is the same hole by another route.
    if (lint !== EXPECTED_LINT) {
      offenders.push(`${manifest.name}: ${lint ?? "(no lint script)"}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `every package's lint script must be exactly "${EXPECTED_LINT}" so no ` +
      "folder can be skipped. Offenders:\n  " +
      offenders.join("\n  "),
  );
});

test("the root test script runs every contract test in scripts/__tests__", () => {
  const testsDir = join(REPO_ROOT, "scripts", "__tests__");
  const present = readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  // Non-empty, or a wrong directory would make this check vacuous.
  assert.ok(
    present.length > 0,
    `no *.test.mjs found in ${testsDir} — this guard is pointed at the wrong place`,
  );

  const rootTest =
    readJson(join(REPO_ROOT, "package.json")).scripts?.test ?? "";
  const unregistered = present.filter(
    (name) => !rootTest.includes(`scripts/__tests__/${name}`),
  );

  assert.deepEqual(
    unregistered,
    [],
    "these contract tests exist but the root `test` script never runs them:\n  " +
      unregistered.join("\n  "),
  );
});
