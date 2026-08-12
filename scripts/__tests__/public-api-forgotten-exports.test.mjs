import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * **The invariant: if a type appears in a public API signature, a consumer must
 * be able to import it from the same package.**
 *
 * API Extractor already detects every violation — it emits
 * `(ae-forgotten-export)` for each type a public signature names but the entry
 * point does not export. The defect was that those are *warnings*: they were
 * written into `packages/<pkg>/<pkg>.api.md`, committed, and reviewed past 23
 * times. `PretableSelectionState`, for one, is the parameter type of the public
 * `PretableSurfaceProps.onSelectionChange` and of `PretableGrid.setSelection`,
 * and a consumer writing either could not name it without reaching into
 * `@pretable/core` — which no doc page tells them to do.
 *
 * So this file turns the existing warnings into a failure. It does not
 * re-implement the analysis; it reads the reports we already generate and
 * already gate on freshness in CI ("API Extractor — report freshness"), and
 * asserts the warning count is zero.
 *
 * **What makes it self-enforcing.** The set of packages is not a list in this
 * file. It is discovered from `api-extractor.json` — the file that *makes* a
 * package produce a report — so a new published package is covered the day it
 * is configured, with no edit here. A package that has the config but no report
 * fails rather than being skipped.
 *
 * `ALLOWED` is the one escape hatch, and it is deliberately awkward: an entry
 * needs a written justification, and an entry that no longer fires is itself a
 * failure. An unexplained or stale allowlist is the same drift this guard
 * exists to stop, so it cannot accumulate quietly. It is empty today and should
 * stay that way — the honest fixes are to export the type or to change the
 * signature so it names one that is already public.
 *
 * Modelled on `packages/grid-core/src/__tests__/column-model-reconciliation-invariant.test.ts`
 * (#266) and `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` (#280):
 * discover the surface, refuse to skip, and put the remedy in the message.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/**
 * Symbols allowed to stay unexported, by package.
 *
 * Every entry MUST carry a justification saying why the type cannot be exported
 * and why the signature cannot name a public one instead. "We have not got to
 * it yet" is not a justification — that is a failing test, which is the point.
 *
 * @type {Record<string, Record<string, string>>}
 */
const ALLOWED = {};

/** `(ae-forgotten-export) The symbol "Foo" needs to be exported ...` */
const FORGOTTEN_RE =
  /\(ae-forgotten-export\) The symbol "([A-Za-z_$][A-Za-z0-9_$]*)"/g;

const REMEDY = [
  "Fix it one of two ways, whichever is true of the type:",
  "  - the consumer needs it -> re-export it from the package's src/public_api.ts;",
  "  - it is internal and leaked -> change the signature to name a type that is",
  "    already public (an alias of a public type is the common case).",
  "Then: pnpm --filter <pkg> build && pnpm api   (build first, or a stale dist/",
  "produces a false report).",
].join("\n");

/**
 * Packages that produce an API report, discovered from the config that makes
 * them produce one. Returns `{ name, reportPath }`, sorted.
 */
function discoverReportedPackages() {
  const found = [];

  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dir = join(PACKAGES_DIR, entry.name);
    let config;

    try {
      config = JSON.parse(
        readFileSync(join(dir, "api-extractor.json"), "utf8"),
      );
    } catch {
      continue; // No report configured for this package.
    }

    // `apiReport.enabled` is inherited from api-extractor.base.json when the
    // package config does not restate it; only an explicit `false` opts out.
    if (config.apiReport?.enabled === false) continue;

    found.push({
      name: entry.name,
      reportPath: join(dir, `${entry.name}.api.md`),
    });
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const REPORTED_PACKAGES = discoverReportedPackages();

test("every package configured for an API report has one", () => {
  assert.ok(
    REPORTED_PACKAGES.length > 0,
    `Found no packages with an api-extractor.json under ${PACKAGES_DIR}. ` +
      "This guard cannot check anything, which means it would pass vacuously. " +
      "If the api-extractor config moved, update discoverReportedPackages().",
  );

  for (const { name, reportPath } of REPORTED_PACKAGES) {
    assert.doesNotThrow(
      () => readFileSync(reportPath, "utf8"),
      `@pretable/${name} is configured for an API report but ${name}.api.md is missing.\n` +
        `Generate it: pnpm --filter @pretable/${name} build && pnpm api`,
    );
  }
});

for (const { name, reportPath } of REPORTED_PACKAGES) {
  test(`@pretable/${name} exports every type its public API names`, () => {
    const raw = readFileSync(reportPath, "utf8");
    const forgotten = new Set(
      [...raw.matchAll(FORGOTTEN_RE)].map((match) => match[1]),
    );

    const excused = ALLOWED[name] ?? {};
    const unexcused = [...forgotten]
      .filter((symbol) => !(symbol in excused))
      .sort();

    assert.deepEqual(
      unexcused,
      [],
      `@pretable/${name} names ${unexcused.length} type(s) in its public API that it does not export:\n` +
        unexcused.map((symbol) => `  - ${symbol}`).join("\n") +
        `\n\nA consumer cannot spell these, so they cannot type a variable or a handler\n` +
        `parameter the package hands them.\n\n${REMEDY}`,
    );

    const stale = Object.keys(excused)
      .filter((symbol) => !forgotten.has(symbol))
      .sort();

    assert.deepEqual(
      stale,
      [],
      `ALLOWED["${name}"] excuses ${stale.length} symbol(s) that no longer trigger\n` +
        `ae-forgotten-export:\n` +
        stale.map((symbol) => `  - ${symbol}`).join("\n") +
        `\n\nThe gap they described is closed. Delete them from ALLOWED in\n` +
        `scripts/__tests__/public-api-forgotten-exports.test.mjs — a stale excuse is\n` +
        `how an allowlist stops meaning anything.`,
    );
  });
}
