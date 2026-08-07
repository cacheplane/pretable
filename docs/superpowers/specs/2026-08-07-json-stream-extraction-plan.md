# Extracting `@cacheplane/json-stream` from pretable

Date: 2026-08-07

## Goal

`@cacheplane/json-stream` is source-resident in `cacheplane/pretable` but belongs
with its siblings `@cacheplane/partial-json` and `@cacheplane/partial-markdown`
in `cacheplane/cacheplane`. Move it, with history, and have pretable consume it
from npm.

## Decisions

- **History preserved** via `git subtree split`, not a fresh copy.
- **Version line continues at `0.0.4`.** npm has `0.0.1`–`0.0.3`; `0.0.3` was
  published from pretable on 2026-08-07 and is the last release from here.
- **pretable consumes from npm.** See the range caveat under Risks.

## What moves

`packages/json-stream` is fully self-contained — 9 source files (1,346 lines),
6 test files (1,581 lines), no `dependencies`, no `devDependencies`, no
`workspace:` protocol usage, no tsconfig `references`, and no non-relative
imports. It builds entirely on root-hoisted devDependencies (`tsup`,
`typescript`, `vitest`, `eslint`, `publint`, `@arethetypeswrong/cli`,
`@types/node`), all of which cacheplane already has.

It has **no api-extractor setup** and is absent from pretable's `api` /
`api:check` scripts, so the public-API gate is unaffected in both directions.

## Sequencing

The dependency direction forces the order: cacheplane must publish `0.0.4`
before pretable can drop the workspace package. Four phases, with a manual step
and a publish between the two code changes.

### Phase 1 — cacheplane: add the package (PR)

1. `git subtree split --prefix=packages/json-stream -b json-stream-history` in
   pretable; fetch that branch into cacheplane and merge with
   `--allow-unrelated-histories` under `packages/json-stream`.
2. Adapt to cacheplane conventions. The package arrives with pretable's shape;
   the deltas are:
   - `package.json`: `repository` → `cacheplane/cacheplane`, `homepage` →
     `github.com/cacheplane/cacheplane/tree/main/packages/json-stream#readme`,
     `bugs` → cacheplane issues, add
     `publishConfig: { access: "public", provenance: true }`,
     `engines: { node: ">=20" }`, `files: ["dist", "README.md", "LICENSE"]`,
     and the sibling script set (`build`, `test`, `test:watch`,
     `test:coverage`, `lint`, `typecheck`, `publint`, `attw`). The `exports`
     map, `main`/`module`/`types`, and `sideEffects` already match.
   - `tsconfig.json`: extend cacheplane's `tsconfig.base.json`. pretable's base
     sets `"types": ["node"]`; cacheplane's does not — verify the package
     compiles without it, since it should have no Node API surface.
   - Add `tsup.config.ts` and `vitest.config.ts` copied verbatim from
     `packages/partial-json`. pretable's `vitest.config.ts` is empty and its
     tsup config points at `tsconfig.build.json`; cacheplane's tsup config
     does not, so `tsconfig.build.json` is dropped.
   - Add `README.md`, `CHANGELOG.md` (carry the existing one), and `LICENSE`
     (byte-identical to cacheplane's root LICENSE).
3. Register in the six places a new cacheplane package must appear:
   - `.github/workflows/ci.yml` — the matrix allowlist. **CI silently skips any
     package not listed here**, so omitting this yields a green but untested PR.
   - `.github/workflows/publish.yml` — add `'json-stream-v*'` to `on.push.tags`.
   - `README.md` — seven spots: packages table, quick start, README links,
     layout tree, package-scoped commands, releasing examples, support links.
   - root `CHANGELOG.md`, `RELEASING.md` tag map, and `pnpm-lock.yaml`.
4. Gate: `pnpm verify` (lint, typecheck, test, build) plus `publint` and
   `attw --pack .` on the new package.

### Phase 2 — npm trusted publishing (manual, user)

Configure a trusted publisher for `@cacheplane/json-stream` on npmjs.com
pointing at **`cacheplane/cacheplane`** and **`publish.yml`**, no environment.
This is not the pretable configuration — the source repo differs from the other
`@cacheplane/*`-scoped work done today.

### Phase 3 — cacheplane: release 0.0.4

Bump to `0.0.4`, write the CHANGELOG entry, commit, then
`git tag json-stream-v0.0.4 && git push origin json-stream-v0.0.4`. The publish
workflow derives directory and version from the tag, verifies they match
`package.json`, and publishes via OIDC with provenance.

Verify on npm: `0.0.4` present, `latest` points at it, `repository` now reads
`cacheplane/cacheplane`, and a provenance attestation is attached — the five
packages published by hand today have none, so this is the first attested
release in the org.

### Phase 4 — pretable: remove the package (PR)

Only after `0.0.4` is live. Eight hard-breaking edits:

| file                                    | change                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/stream-adapter/package.json`  | dep `workspace:*` → npm range; **remove** the `pnpm --filter @cacheplane/json-stream build &&` prefix from `build`, `test`, `typecheck` |
| `packages/stream-adapter/tsconfig.json` | drop the `../json-stream` project reference                                                                                             |
| `tsconfig.json` (root)                  | drop the `./packages/json-stream` reference                                                                                             |
| `.changeset/config.json`                | `fixed` group → `[["@pretable/core", "@pretable/react"]]`                                                                               |
| `package.json` (root)                   | drop json-stream from the `lint:packaging` chain                                                                                        |
| `.github/workflows/ci.yml:89`           | drop the `--filter '@cacheplane/json-stream'`                                                                                           |
| `pnpm-lock.yaml`                        | regenerate                                                                                                                              |
| `packages/json-stream/`                 | delete                                                                                                                                  |

The two source imports in `packages/stream-adapter/src/parse-element-stream.ts`
and `parse-partial-stream.ts` are unchanged — same specifier, now resolved from
npm instead of the workspace link.

Stale-but-harmless, worth doing in the same PR: `README.md:25,132`,
`CONTRIBUTING.md:51`, and the `@cacheplane/json-stream` option in both
`.github/ISSUE_TEMPLATE/*.yml` dropdowns. The ~260 historical mentions under
`docs/` are a record of past work and stay as they are.

## Risks

**Stale filters fail silently.** `pnpm --filter <nonexistent> build` prints
"No projects matched the filters" and **exits 0** — verified. Leaving those
prefixes in stream-adapter's scripts would not fail; it would quietly stop
building a dependency. They must be deleted, not merely made inert.

**`^0.0.4` does not range.** Verified: `^0.0.4` is `>=0.0.4 <0.0.5-0`, so it
pins to exactly `0.0.4` and every json-stream patch needs a matching pretable
bump. `~0.0.4` is `>=0.0.4 <0.1.0-0` and picks up patches automatically.
**Recommend `~0.0.4`** unless the pin is wanted deliberately.

**Preflight will not catch a bad range.** `scripts/publish-preflight.mjs`
filters dependency edges to `@pretable/*` only, so the `@cacheplane/json-stream`
edge is unvalidated today and stays unvalidated as an external dependency — a
version that does not exist on npm would pass preflight and fail at install.
Worth widening the scope filter as a follow-up; out of scope here.

**Toolchain skew.** pretable is pnpm 10.12.1 / Node >=22; cacheplane is
pnpm 9.15.9 / Node >=20. The package must build and test under the older pair.

**Rollback is clean.** Phases 1–3 are additive: until Phase 4 merges, pretable
still builds json-stream from the workspace and nothing depends on the npm
release. If Phase 3 fails, stop — nothing to undo.

## Out of scope

- Widening preflight's dependency-edge scope filter.
- Adopting changesets in cacheplane (deliberately deferred there).
- The `homepage` URL pointing at `pretable.ai/docs/streaming/parsers`; it
  becomes a cross-repo link, and the docs page it names never mentions
  json-stream anyway.
