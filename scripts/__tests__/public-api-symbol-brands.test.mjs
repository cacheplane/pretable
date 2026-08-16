import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * **The invariant: no published type may be branded by a `unique symbol`.**
 *
 * A `unique symbol` is nominal PER DECLARATION FILE. Pretable's published
 * declarations exist in more than one file by construction: `tsc` emits
 * `@pretable-internal/*` into each package's own `dist`, and `tsup`'s bundled
 * `.d.ts` re-emits the same declarations into `packages/core/dist` (they are
 * `noExternal`, so the bundle owns one runtime copy of each private engine).
 * Every re-emission of a `declare const brand: unique symbol` mints a NEW type,
 * so two spellings of one declaration stop being assignable to each other.
 *
 * That is not hypothetical. Four brands were affected — `groupIdBrand` and
 * `rowModelDescriptor` (row-model `types.ts`), `columnDescriptor` (row-model
 * `column-types.ts`) and `gridUiCoreType` (grid-core `types.ts`) — and two of
 * them were live: `packages/react/src/pretable-model.ts` carried two
 * `as unknown as` casts whose only job was to cross the seam. The silent half
 * was worse than the casts: `RowOf<>` / `RowIdOf<>` / `ColumnsOf<>` match
 * structurally on the row-model brand, so across the seam they resolved to
 * `never` with no error at all.
 *
 * The remedy is a string-literal key (`readonly "~pretableGroupId"`), which is
 * structural: N copies of the declaration are one type. Nominality survives
 * because the branded types are intersections nothing can inhabit by accident,
 * and the `~` prefix keeps the key unwritable as an identifier.
 *
 * **What this guard reads, and why.** The committed `.api.md` reports, not
 * `dist/`. They are always present (a missing one already fails
 * `public-api-forgotten-exports.test.mjs`), their freshness is separately gated
 * by the required "API Extractor — report freshness" check, and — unlike a
 * `dist/` scan — they show only what is actually PUBLISHED. A symbol brand
 * surfaces there unmistakably: API Extractor prints the member's computed key
 * verbatim (`readonly [groupIdBrand]: "PretableGroupId";`) while never emitting
 * the ambient `declare const` it names, so the report is not even self-
 * consistent.
 *
 * **What makes it self-enforcing.** The package set is discovered from
 * `api-extractor.json` — the file that MAKES a package produce a report — so a
 * newly published package is covered the day it is configured, with no edit
 * here. Modelled on `scripts/__tests__/public-api-forgotten-exports.test.mjs`.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/**
 * A member keyed by a computed identifier: `readonly [groupIdBrand]: ...`,
 * `[rowModelDescriptor]?: ...`. Deliberately NOT anchored on `readonly` — a
 * mutable or optional brand is the same defect.
 *
 * Well-known symbols (`[Symbol.iterator]`, `[Symbol.asyncIterator]`) are real,
 * legitimate computed keys and are excluded: they are declared by the standard
 * library, so every declaration file resolves them to the SAME symbol and none
 * of the reasoning above applies.
 */
const SYMBOL_KEYED_MEMBER_RE =
  /^\s*(?:readonly\s+)?\[([A-Za-z_$][A-Za-z0-9_$]*)\]\??\s*:/gm;

const REMEDY = [
  "Replace the `unique symbol` key with a string-literal key:",
  "",
  "  -declare const fooBrand: unique symbol;",
  "  -export type Foo = string & { readonly [fooBrand]: 'Foo' };",
  "  +export type Foo = string & { readonly '~pretableFoo': 'Foo' };",
  "",
  "It is structural, so the copy `tsup` re-emits into packages/core/dist is the",
  "SAME type as the one `tsc` emits into the internal package's dist. A string",
  "key is no weaker here: the branded types are intersections no literal can",
  "inhabit without a cast, and `~` cannot be written as an identifier.",
  "",
  "Then: pnpm build && pnpm api   (build first, or a stale dist/ produces a",
  "false report).",
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

test("the symbol-brand guard has reports to read", () => {
  assert.ok(
    REPORTED_PACKAGES.length > 0,
    `Found no packages with an api-extractor.json under ${PACKAGES_DIR}. ` +
      "This guard cannot check anything, which means it would pass vacuously. " +
      "If the api-extractor config moved, update discoverReportedPackages().",
  );
});

for (const { name, reportPath } of REPORTED_PACKAGES) {
  test(`@pretable/${name} brands no published type with a unique symbol`, () => {
    const raw = readFileSync(reportPath, "utf8");

    const offenders = [...raw.matchAll(SYMBOL_KEYED_MEMBER_RE)]
      .map((match) => ({
        key: match[1],
        line: raw.slice(0, match.index).split("\n").length,
      }))
      .filter((hit) => !hit.key.startsWith("Symbol"));

    assert.deepEqual(
      offenders.map((hit) => `${name}.api.md:${hit.line} [${hit.key}]`),
      [],
      `@pretable/${name} publishes ${offenders.length} type member(s) keyed by a symbol.\n` +
        `A \`unique symbol\` is nominal per declaration file, and these declarations are\n` +
        `emitted into more than one file, so each copy is a different type — which shows\n` +
        `up as a cast at the seam, or as a conditional type silently resolving to never.\n\n` +
        `${REMEDY}`,
    );
  });
}
