import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { benchAdapterFamilies } from "../../shared/bench-adapter-families.js";
import {
  benchAdapterPackages,
  benchComparatorAdapterIds,
  readAdapterVersions,
} from "../../shared/bench-adapter-packages.js";

/**
 * **The invariant: a committed comparative benchmark number must say which
 * version of the comparator it was measured against, and if that version is no
 * longer the one installed, it must say so.**
 *
 * The defect this exists for: as of 2026-08 eleven files under
 * `status/milestones/` carried competitor numbers measured in May 2026, and not
 * one of them recorded a comparator version — there was no version string in
 * the directory at all. Three comparator majors then landed on top of them:
 *
 *   - `@mui/x-data-grid` 7 -> 8 (#162) -> 9 (#150)
 *   - `ag-grid-community` 33 -> 35 (#162) -> 36 (#306)
 *
 * None of those PRs re-measured, and none marked the numbers invalidated,
 * because nothing could tell that they had gone stale. A reader opening any of
 * those files could not determine what the claim was a claim about.
 *
 * Two rules, both fail-closed:
 *
 *   1. **Every comparator-bearing milestone carries provenance.** A file that
 *      names a comparator adapter must have an `adapterVersions.adapters` entry
 *      for it, listing exactly the packages in {@link benchAdapterPackages}. A
 *      new comparative artifact cannot be committed without one — the harness
 *      writes it automatically (`createAdapterVersionsRecord`), so the only way
 *      to land here without it is to hand-write an artifact, which is precisely
 *      the case worth failing.
 *   2. **Recorded versions match the tree, or the file is marked superseded.**
 *      A milestone whose recorded comparator version differs from the installed
 *      one fails, with the remedy being either a re-measure or an explicit
 *      `superseded` block. Marking is not a loophole: it is a written statement,
 *      in the artifact, that the number describes a release the repo no longer
 *      builds against — which is the thing a reader needed and never had.
 *
 * **What makes it self-enforcing.** The set of files is not a list in this
 * file; it is every `.json` under `status/milestones/`. Which adapters a file
 * measured is not a list either — it is read out of the document, by walking
 * for any occurrence of a known adapter id as a value or as a key, because the
 * eleven files use at least three different shapes for it (`adapters: [{
 * adapterId }]`, `matrix.adapters: [...]`, and `perAdapter: { mui: ... }`). The
 * walk deliberately over-detects rather than under-detects: a false positive
 * demands provenance for an adapter a file only mentions, which is harmless; a
 * false negative is the bug this guard exists to prevent.
 *
 * `pretable` is checked for provenance but NOT for version equality. Its
 * version moves on every release, so pinning committed evidence to it would
 * make every release a failing check while saying nothing about the comparator
 * — the control side, and the side that actually drifted unnoticed.
 *
 * Modelled on `scripts/__tests__/public-api-forgotten-exports.test.mjs` and
 * `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`: discover the
 * surface, refuse to skip, put the remedy in the message.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MILESTONES_DIR = join(REPO_ROOT, "status", "milestones");

const KNOWN_ADAPTER_IDS = Object.keys(benchAdapterPackages);

const REMEDY_MISSING = [
  "Comparative evidence must record what it was measured against.",
  "  - A runset written by `pnpm bench:matrix` carries `adapterVersions`",
  "    automatically; copy the report as-is instead of hand-editing it.",
  "  - A hand-assembled summary needs the same block, and the versions must be",
  "    read from the installed manifests, never typed:",
  "      node -e \"import('./shared/bench-adapter-packages.js').then(m => console.log(JSON.stringify(m.createAdapterVersionsRecord(['ag-grid','mui','tanstack']), null, 2)))\"",
].join("\n");

const REMEDY_STALE = [
  "A committed comparative number no longer matches the comparator in the tree.",
  "Pick one, and only one is a no-op:",
  "  - re-measure on a quiet machine and commit the fresh runset; or",
  "  - add an `adapterVersions.superseded` block to the file saying which",
  "    comparator moved and that the numbers describe the older release.",
  "Do NOT edit the recorded versions to match the tree — that would claim a",
  "measurement that never happened.",
].join("\n");

/**
 * Every adapter id the document mentions, as a value or as an object key.
 *
 * @param {unknown} node
 * @param {Set<string>} found
 */
function collectAdapterIds(node, found) {
  if (typeof node === "string") {
    if (KNOWN_ADAPTER_IDS.includes(node)) found.add(node);
    return;
  }

  if (Array.isArray(node)) {
    for (const value of node) collectAdapterIds(value, found);
    return;
  }

  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (KNOWN_ADAPTER_IDS.includes(key)) found.add(key);
      collectAdapterIds(value, found);
    }
  }
}

/** @returns {{ name: string, document: unknown, adapterIds: string[] }[]} */
function readMilestones() {
  const files = readdirSync(MILESTONES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  assert.ok(
    files.length > 0,
    `No milestone artifacts found under ${MILESTONES_DIR}. This guard reads the ` +
      "committed evidence; an empty directory means it is checking nothing.",
  );

  return files.map((name) => {
    const raw = readFileSync(join(MILESTONES_DIR, name), "utf8");
    let document;

    try {
      document = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `status/milestones/${name} is not valid JSON, so its provenance cannot be checked.`,
        { cause },
      );
    }

    const found = new Set();
    collectAdapterIds(document, found);

    return { name, document, adapterIds: [...found].sort() };
  });
}

test("the adapter roster and the package roster describe the same adapters", () => {
  assert.deepEqual(
    Object.keys(benchAdapterPackages).sort(),
    Object.keys(benchAdapterFamilies).sort(),
    "shared/bench-adapter-packages.js and shared/bench-adapter-families.js must " +
      "cover the same adapter ids: an adapter with a family but no packages " +
      "measures without provenance, which is the hole this guard closes.",
  );

  for (const [adapterId, packages] of Object.entries(benchAdapterPackages)) {
    assert.ok(
      Array.isArray(packages) && packages.length > 0,
      `Adapter "${adapterId}" lists no packages, so nothing pins what it measured.`,
    );
  }

  assert.ok(
    benchComparatorAdapterIds.length > 0,
    "No comparator adapters are registered; this guard would check nothing.",
  );
});

test("every comparator-bearing milestone records the versions it measured against", () => {
  for (const { name, document, adapterIds } of readMilestones()) {
    const comparators = adapterIds.filter((adapterId) =>
      benchComparatorAdapterIds.includes(adapterId),
    );

    if (comparators.length === 0) continue;

    const record = document.adapterVersions;

    assert.ok(
      record && typeof record === "object",
      `status/milestones/${name} carries numbers for ${comparators.join(", ")} ` +
        `but has no \`adapterVersions\` block.\n\n${REMEDY_MISSING}`,
    );
    assert.ok(
      typeof record.source === "string" && record.source.length > 0,
      `status/milestones/${name}: \`adapterVersions.source\` must say where the ` +
        `versions were read from.\n\n${REMEDY_MISSING}`,
    );
    assert.ok(
      record.adapters && typeof record.adapters === "object",
      `status/milestones/${name}: \`adapterVersions.adapters\` is missing.\n\n${REMEDY_MISSING}`,
    );

    for (const adapterId of comparators) {
      const recorded = record.adapters[adapterId];

      assert.ok(
        recorded && typeof recorded === "object",
        `status/milestones/${name} reports on "${adapterId}" but records no ` +
          `versions for it.\n\n${REMEDY_MISSING}`,
      );
      assert.deepEqual(
        Object.keys(recorded).sort(),
        [...benchAdapterPackages[adapterId]].sort(),
        `status/milestones/${name}: the packages recorded for "${adapterId}" do not ` +
          "match the roster in shared/bench-adapter-packages.js. Every package that " +
          "moves the measurement has to be named, and only those.\n\n" +
          REMEDY_MISSING,
      );

      for (const [packageName, version] of Object.entries(recorded)) {
        assert.ok(
          typeof version === "string" && /^\d+\.\d+\.\d+/.test(version),
          `status/milestones/${name}: "${packageName}" is recorded as ` +
            `${JSON.stringify(version)}, which is not a resolved version.\n\n${REMEDY_MISSING}`,
        );
      }
    }
  }
});

test("a milestone whose recorded comparator version has drifted is marked superseded", () => {
  const installed = Object.fromEntries(
    benchComparatorAdapterIds.map((adapterId) => [
      adapterId,
      readAdapterVersions(adapterId),
    ]),
  );

  for (const { name, document, adapterIds } of readMilestones()) {
    const record = document.adapterVersions;

    if (!record) continue;

    const comparators = adapterIds.filter((adapterId) =>
      benchComparatorAdapterIds.includes(adapterId),
    );

    if (comparators.length === 0) continue;

    const drifted = [];

    for (const adapterId of comparators) {
      for (const [packageName, version] of Object.entries(
        record.adapters[adapterId] ?? {},
      )) {
        const current = installed[adapterId][packageName];

        if (current !== version) {
          drifted.push(
            `${packageName}: measured ${version}, installed ${current}`,
          );
        }
      }
    }

    if (drifted.length === 0) {
      assert.equal(
        record.superseded,
        undefined,
        `status/milestones/${name} is marked superseded, but every comparator ` +
          "version it records still matches the tree. A stale marker teaches " +
          "readers to ignore markers — drop it.",
      );
      continue;
    }

    assert.ok(
      record.superseded && typeof record.superseded === "object",
      `status/milestones/${name} was measured against comparator versions that are ` +
        `no longer installed:\n  ${drifted.join("\n  ")}\n\n${REMEDY_STALE}`,
    );
    assert.ok(
      typeof record.superseded.reason === "string" &&
        record.superseded.reason.length > 0,
      `status/milestones/${name}: \`adapterVersions.superseded\` needs a \`reason\` ` +
        `naming what moved.\n\n${REMEDY_STALE}`,
    );
  }
});
