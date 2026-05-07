# Tier 1 Sub-project A — Public API Stabilization Design

> Status: spec. 2026-05-07. Workflow: subagent-driven implementation; spec + plan ship inside the implementation PRs.

## Goal

Lock the public surface of the four `@pretable/*` packages — `@pretable/core`, `@pretable/react`, `@pretable/ui`, `@pretable/stream-adapter` — into a state we'd be willing to put a 1.0 stamp on. "Lock" here means three things in tension:

- **Inventoried.** Every public symbol is named on purpose, documented with TSDoc, and visible in a generated `<package>.api.md` snapshot.
- **Cleaned.** Naming inconsistencies, leaked engine shapes, duplicated stories, and obvious-internal leakage are fixed before the snapshot is written.
- **Visible to PRs.** Future surface changes regenerate the `.api.md` snapshot; the diff appears in PR review. We do **not** add a fail-on-drift gate — pretable is pre-1.0 and the surface is allowed to evolve. The snapshot exists for visibility, not enforcement.

`@cacheplane/json-stream` is out of scope (separate org, separate stabilization timeline).

## Architecture

The public surface story uses [hashbrown](https://github.com/liveloveapp/hashbrown)'s convention as the reference pattern, applied to pretable's pnpm-workspace layout.

### Public-surface authoring

Each package's source layout becomes:

```
packages/<name>/src/
  index.ts          // export * from './public_api';
  public_api.ts     // hand-curated re-exports, the entire public surface
  ...other files (internal modules)
```

`public_api.ts` is the **only** file in the package whose contents are reviewed for public-API impact. `index.ts` is one line. Anything not re-exported through `public_api.ts` is internal to the package; if another `@pretable/*` package needs it, it gets the `ɵ`-prefix treatment described below.

### Release tags (TSDoc, validated by api-extractor)

Every symbol in `public_api.ts` carries one TSDoc release tag:

- **`@public`** — stable. We'll try not to break it pre-1.0; we won't promise we won't.
- **`@beta`** — experimental, real users can use it but expect change. Used for surfaces that are clearly going to evolve (current candidates: `InspectionGrid`, `LabeledGridSurface`).
- **`@internal`** — exported but not API. Used for symbols that need to be importable across `@pretable-internal/*` boundaries but aren't intended for external consumers. Marked with `@internal` AND given the `ɵ`-prefix at the re-export site (e.g., `export { foo as ɵfoo }`). The internal naming inside the package stays clean; only the public-surface re-export wears the prefix.

Any exported symbol without a release tag is a TSDoc warning at api-extractor time; CI surfaces but does not fail on these in this sub-project's PRs (we'll harden later if needed).

### api-extractor in report mode

api-extractor runs per package, producing `<unscoped-name>.api.md` at the package root (e.g., `packages/core/core.api.md`). The report is checked in. PRs that change the surface produce a `.api.md` diff that reviewers see.

CI runs api-extractor in **non-local** mode, which fails if the committed `.api.md` differs from what the current code would generate. The remedy is `pnpm api` locally and committing the regenerated file. This forces the diff into the PR — it does not block intentional changes.

`api-extractor.base.json` lives at the repo root; per-package `api-extractor.json` extends it. `bundledPackages: ["@pretable/core", "@pretable/react", "@pretable/ui", "@pretable/stream-adapter"]` ensures each report is self-contained when packages re-export from each other.

A separate `tsconfig.docs.json` per package points api-extractor at the built `.d.ts` (matching hashbrown's pattern).

### Per-package READMEs

Each package gets a `README.md` (replacing the current absence). Prose-level: what is this package, when do you reach for it, install command, one minimal usage example, and a "see `<name>.api.md` for the full surface" link. Not a full API doc — that's what `.api.md` is for.

## Components — per-package targets

The cleanup itself is governed by each PR's audit pass. The targets below are the ones surfaced during brainstorming; the implementation PRs are free to find more during their audits and may decline to act on items that turn out to be wrong. None of these are mandatory; each is a decision the audit makes on the merits.

### `@pretable/core` (PR 2)

Likely actions:

- Replace `PretableGrid extends Omit<GridCoreStore<TRow>, "options">` with a clean explicit interface that names the methods and properties pretable promises, no longer `Omit`-leaking the engine type.
- Decide what to do with `PretableCoreColumn`: most users consume `@pretable/react`'s `PretableColumn` (which is core's column + `format`/`render`). If `PretableCoreColumn` has no headless-mode use case yet, demote with `ɵ`-prefix or remove from the public surface.
- TSDoc + release tag on every type alias.
- New `core.api.md` committed.
- Per-package `README.md`.

### `@pretable/react` (PR 3)

Likely actions:

- Resolve `Pretable` vs `PretableSurface` story. Docs treat `PretableSurface` as primary; `Pretable` may be a thin convenience wrapper that's worth keeping or worth removing. Audit decides.
- Density duplication: `useResolvedHeights` + `DensityHeights` here vs `getDensityHeights` + `DensityHeights` in `@pretable/ui`. Pick one canonical home (likely `@pretable/ui` since the heights are CSS-token-derived); the other side imports + re-exports.
- Three overlapping snapshot-shaped types — `PretableModel`, `PretableSurfaceState`, `PretableRenderSnapshot` — audit, consolidate, or document why each is distinct.
- `usePretable` vs `usePretableModel` — only `usePretableModel` is used in docs; decide if both stay public or one is `@beta` / removed.
- `InspectionGrid`, `LabeledGridSurface` — likely tag `@beta`.
- `measureRenderedRowHeight`, `ROW_SELECT_COLUMN_ID` — likely demote with `ɵ`-prefix unless an external use case justifies them.
- Tag the leaked re-exports from `@pretable/core` consistently.
- TSDoc + release tag on every symbol.
- `react.api.md`, `README.md`.

### `@pretable/ui` (PR 4, parallel with PR 5)

Likely actions:

- Lock the CSS classnames in the README and `.api.md` prose section as part of the v1 contract (the JS surface is tiny: `getDensityHeights`, `DensityHeights`).
- Verify `getDensityHeights` is the single density entry point if PR 3 chose to re-route through `@pretable/ui`.
- TSDoc on `getDensityHeights` + `DensityHeights`.
- `ui.api.md`, `README.md`.

### `@pretable/stream-adapter` (PR 5, parallel with PR 4)

Likely actions:

- Verify the connect/parse pair is symmetric: `connectElementStream`/`parseElementStream`, `connectPartialStream`/`parsePartialStream`. Names should make the pairing obvious.
- `GridLike` is structurally typed (clean) — keep, document its contract.
- TSDoc + release tag on every symbol.
- `stream-adapter.api.md`, `README.md`.

## Data flow

Author writes TSDoc → `pnpm api` runs api-extractor for changed packages → `.api.md` regenerated → committed → PR shows diff alongside source diff → reviewer reads both. CI re-runs api-extractor non-locally; mismatch between regenerated and committed `.api.md` fails the build with a clear "run pnpm api" message.

There is no other downstream consumer of the api-extractor output in this sub-project. (api-extractor's JSON model and dts-rollup features are not wired up; they're future work if we ever generate website docs from it.)

## Error handling

The only failure modes inside this sub-project are tooling and process:

- **api-extractor on missing tag.** Symbol has no release tag. api-extractor logs a warning. CI surfaces the warning but doesn't fail the build during the audit PRs (we may harden after the audits land).
- **api-extractor report drift.** Committed `.api.md` doesn't match generated. CI fails with a `pnpm api` instruction. This is the visibility-mechanism described above; it's the intended failure mode for surface-changing PRs.
- **Type errors from cleanup.** Renames or shape changes break internal imports. Caught by the existing `pnpm -w typecheck` step on each PR. The audit fixes them inline.

## Testing

Per-package PRs run the existing repo-wide gates: `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w lint`, `pnpm format`, plus the new `pnpm api` step. No new test categories.

The audits intentionally do not change runtime behavior — they're rename/reshape/demote at the type and export level. Existing test coverage continues to gate against accidental behavior change. Where a cleanup _does_ change behavior (e.g., consolidating overlapping snapshot types may shift what a hook returns), the audit PR adds or updates the relevant test.

## PR sequence

5 PRs total, sequential where dependencies require it.

1. **PR 1 — Infrastructure.** Install `@microsoft/api-extractor` + `@microsoft/tsdoc` as devDeps. Add `api-extractor.base.json` at repo root. Add `pnpm api` script that runs api-extractor for every published package. Wire CI step. **No source changes** — every existing package starts producing an empty/full `.api.md` with whatever the current surface looks like, committed as the baseline. This PR is the visibility floor; subsequent PRs change `.api.md` files visibly.

2. **PR 2 — `@pretable/core` audit.** Move to `public_api.ts`, run cleanup pass, add TSDoc, regenerate `core.api.md`, write `README.md`.

3. **PR 3 — `@pretable/react` audit.** Same shape. Builds on the names locked in PR 2. May force re-tagging in core if PR 3's audit surfaces something PR 2 missed; that's a small follow-up commit on PR 3.

4. **PR 4 — `@pretable/ui` audit.** Tiny package; same shape.

5. **PR 5 — `@pretable/stream-adapter` audit.** Same shape. PR 4 and PR 5 can land in either order after PR 3.

PRs 4 and 5 may be developed in parallel worktrees but must rebase onto each other before merge if they touch shared infra files.

This umbrella spec covers all 5 PRs at the design level. Each PR gets its own focused implementation plan generated when its work begins — PR 1's plan covers the tooling install only; PRs 2–5 each get a plan covering one package's audit, cleanup, and deliverables. Plans are written just-in-time so each can incorporate what was learned from the previous PR's audit (e.g., `@pretable/react`'s plan can reference whatever `@pretable/core`'s audit decided about `PretableCoreColumn`).

## What this sub-project does **not** do

- No api-extractor gate that blocks **intentional** surface changes. The CI check described above blocks **unintentional** drift only — i.e., the author forgot to run `pnpm api` after changing exports. Intentional changes pass CI as soon as the regenerated `.api.md` is committed.
- No .api.md → website docs pipeline. Future work; would use api-extractor's JSON doc model.
- No comparative public-API benchmarking against other grids.
- No removal of `@pretable-internal/*` workspace packages from publish — those continue to be private workspace deps.
- No semver discipline doc / deprecation policy. Pre-1.0; will be added when the first external consumer is in sight.
- No package consolidation. The four-package split is treated as final.
- `@cacheplane/json-stream` is not audited here.

## Success criteria

- Every package's `src/` has `index.ts` reduced to `export * from './public_api'` and a hand-curated `public_api.ts`.
- Every public symbol carries a TSDoc release tag.
- `<package>.api.md` is committed for all four packages and matches what `pnpm api` would generate.
- Per-package `README.md` exists with prose intro + minimal example.
- The four "likely actions" lists in §Components are either applied or have a one-line rationale in the PR description for declining.
- The four PRs all merge cleanly under the existing CI gates plus the new `pnpm api` check.
