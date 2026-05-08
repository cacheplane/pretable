# Tier 1 Sub-project A — PR 2 (`@pretable/core` audit) Design

> Status: spec. 2026-05-08. PR 2 of 5 in [Tier 1 Sub-project A — Public API Stabilization](2026-05-07-tier1-public-api-stabilization-design.md).

## Goal

Lock `@pretable/core`'s public surface into a state appropriate for a future headless engine (long-term scope) while shipping only the type cleanup now (no docs/examples — that's deferred per `project_headless_engine_docs_deferred.md` memory). Eliminate the `GridCore*` naming leakage by renaming the engine-level types at source and re-exporting them under their natural `Pretable*` names.

## Non-goals

- No `@pretable/react` audit. PR 3 owns react's surface; this PR only touches react where the rename forces a mechanical import update.
- No headless-mode website docs, no `apps/headless-demo`, no `examples/headless-*` content. Deferred per memory.
- No `@pretable-internal/grid-core` package consolidation into `@pretable/core`. Engine package stays separate.
- No new tests beyond rename ripple. Existing tests cover behavior; the audit is type-level.

## Architecture

### Public-surface layout

`@pretable/core/src/` becomes:

```
src/
  index.ts          // export * from './public_api';
  public_api.ts     // hand-curated re-exports, TSDoc + @public on each
  types.ts          // re-exports from @pretable-internal/grid-core
  create-grid.ts    // unchanged
```

`public_api.ts` is the only file whose contents are reviewed for public-API impact. `index.ts` is one line.

### Engine type rename (the structural change)

`@pretable-internal/grid-core` is the underlying engine; today its types use `GridCore*` naming and `@pretable/core` aliases them with `Pretable*` names. Aliasing creates `ae-forgotten-export` warnings and leaks the internal name through `extends` clauses.

**Resolution:** rename the engine types at source. The engine becomes `Pretable*`-named in `@pretable-internal/grid-core`'s own `src/types.ts`. `@pretable/core/types.ts` collapses from ~50 lines of aliases to a clean re-export shell.

`@pretable-internal/grid-core` and `@pretable-internal/layout-core` are added to `bundledPackages` in `api-extractor.base.json` so the renamed types appear inlined in `core.api.md` rather than as `import { … } from '@pretable-internal/…'` references. Each `.api.md` stays self-contained.

### `PretableGrid` interface

The current `PretableGrid extends Omit<GridCoreStore<TRow>, "options">` is replaced with an explicit interface in `@pretable/core` that lists every method/property pretable promises. After rename, `GridCoreStore` becomes `PretableEngine` at the engine source — but `PretableGrid` becomes a *new, narrower* interface in `@pretable/core` that `createGrid` returns. The internal engine factory (`createGridCore`) returns `PretableEngine`; `createGrid` wraps/casts to the public `PretableGrid`.

The rationale: `Omit<>` inheritance leaks the engine type into the public surface and forces every `.api.md` reader to mentally subtract a key. An explicit interface is what users will read in IDE tooltips.

## Components

### Rename map

In `@pretable-internal/grid-core/src/types.ts` and `create-grid-core.ts`:

| Internal (today) | After rename | Notes |
|---|---|---|
| `GridCoreCellAddress` | `PretableCellAddress` | Already aliased — absorb. |
| `GridCoreCellRange` | `PretableCellRange` | Already aliased — absorb. |
| `GridCoreColumn` | `PretableColumn` | Was `PretableCoreColumn`. React imports as `PretableBaseColumn` to disambiguate from its own `PretableColumn`. PR 3 fully resolves the naming. |
| `GridCoreFocusDirection` | `PretableFocusDirection` | Already aliased — absorb. |
| `GridCoreFocusState` | `PretableFocusState` | Already aliased — absorb. |
| `GridCoreFormatInput` | `PretableFormatInput` | Was an alias — absorb. |
| `GridCoreMoveFocusOptions` | `PretableMoveFocusOptions` | Already aliased — absorb. |
| `GridCoreOptions` | `PretableGridOptions` | Was an alias — absorb. |
| `GridCoreRow` | `PretableRow` | Was a `Record<string, unknown>` constraint; `PretableRow` already exists in `@pretable/core/types.ts`. Unify on the public name. |
| `GridCoreRowModel` | `PretableVisibleRow` | Already aliased — absorb. |
| `GridCoreSelectionState` | `PretableSelectionState` | Already aliased — absorb. |
| `GridCoreSnapshot` | `PretableGridSnapshot` | Already aliased — absorb. |
| `GridCoreSortDirection` | `PretableSortDirection` | Already aliased — absorb. |
| `GridCoreSortState` | `PretableSortState` | Already aliased — absorb. |
| `GridCoreStore` | `PretableEngine` | Internal engine handle returned by `createGridCore`. Distinct from public `PretableGrid` (see Architecture). |
| `GridCoreTransaction` | `PretableTransaction` | Was an alias — absorb. |
| `GridCoreViewportState` | `PretableViewportState` | Already aliased — absorb. |
| `RowSelectionTriState` | `PretableRowSelectionTriState` | Already aliased — absorb. |

In `@pretable-internal/layout-core/src/types.ts`:

| Internal (today) | After rename | Notes |
|---|---|---|
| `LayoutSpan` | `PretableRowRange` | Semantic name — it represents the visible-row index range exposed via `PretableGridSnapshot.visibleRange`. |

`AutosizeOptions` keeps its name (already pretable-friendly).

### `@pretable/core` public surface (post-rename)

`public_api.ts` re-exports, every symbol carrying `@public` + a one-line TSDoc summary:

```
export { createGrid } from "./create-grid";
export type { PretableGrid } from "./pretable-grid";
export type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableFocusState,
  PretableFormatInput,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableRow,
  PretableRowRange,
  PretableRowSelectionTriState,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortState,
  PretableTransaction,
  PretableViewportState,
  PretableVisibleRow,
} from "./types";
```

`pretable-grid.ts` is the new file holding the explicit `PretableGrid` interface — defined locally, not re-exported from the engine. (`@pretable-internal/grid-core`'s engine handle is the renamed `PretableEngine`, separate from public `PretableGrid`.) `types.ts` does not re-export `PretableGrid`.

### TSDoc style

- One-line summary above every symbol.
- `@example` blocks **only** for `createGrid` and the new `PretableGrid` interface.
- Type aliases get one-line summaries; no examples.

### `ae-missing-release-tag` config

PR 1 set this rule's `logLevel` to `none` to allow undocumented baselines. PR 2 keeps it at `none` because — as discovered during implementation — api-extractor's non-local mode treats `warning`-level extractor messages as **fatal** (exit 1), opposite of what the spec originally assumed. Flipping to `warning` would break `api:check` for `@pretable/react`, `@pretable/ui`, and `@pretable/stream-adapter` (which still have untagged symbols pending PRs 3–5). The flip moves to PR 5 once every package is fully tagged.

Additionally, `ae-unresolved-link` is silenced (`logLevel: none`) because cross-package `{@link …}` references — e.g., a TSDoc in `@pretable/core`'s `pretable-grid.ts` linking to `createGrid` — cannot resolve when api-extractor processes a different package whose bundled report inlines the source. The links work fine in IDE tooltips; only the bundled-report resolver fails. Silencing avoids false-positive CI failures.

## Data flow

1. Author renames at engine source (`@pretable-internal/{grid-core,layout-core}`).
2. Internal consumers (`@pretable-internal/renderer-dom`, `@pretable/react/src/types.ts`'s import alias) updated.
3. `@pretable/core/types.ts` collapses to clean re-exports.
4. New `@pretable/core/src/pretable-grid.ts` defines the explicit `PretableGrid` interface.
5. `public_api.ts` re-exports with TSDoc.
6. `api-extractor.base.json` updates `bundledPackages` to include the two internal packages.
7. `pnpm api` regenerates `core.api.md` (large diff: zero `ae-forgotten-export` warnings, type aliases now show `@public` documented entries).
8. `react.api.md` regenerated as a side effect of the rename + bundledPackages change. Verify the diff is mechanical (renames only, no shape change).

## Error handling

This PR's failure modes are tooling and process:

- **Internal compile errors after rename.** Caught by `pnpm -w typecheck`. The audit fixes them inline.
- **`react.api.md` drifts unexpectedly.** PR's job to verify the drift is rename-only; if shapes change, regress.
- **`ae-missing-release-tag` warnings remain in `core.api.md`.** Means a symbol slipped past tagging. Fix during the audit, not after.
- **CI fails because `pnpm api:check` mismatches.** Run `pnpm api`, commit, retry.

## Testing

Repo-wide gates: `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w lint`, `pnpm format`, `pnpm api:check`.

No new test categories. Existing test coverage already exercises the renamed types under their old names; renames cascade through fine. The single test file under `packages/grid-core/src/__tests__/selection-state.test.ts` that imports `GridCore*` types directly gets a mechanical update.

## Per-package README

`packages/core/README.md` ~80 lines:

- One-paragraph "what is `@pretable/core`" — the headless engine. Most users reach for `@pretable/react`; this package exists for users who want to drive their own UI from the engine state.
- "When to use" — 2-3 sentences. Mention that headless usage is supported but full docs/examples/demos are forthcoming (links to the deferred-memory's "future task triggers" framing without naming the memory).
- Install command and minimal `createGrid` example.
- "See [`core.api.md`](./core.api.md) for the full public surface."
- License/contributing footer matching repo style.

## PR shape

Single PR. The rename is mechanical and atomic — splitting would force `@pretable/react` to compile against half-renamed engine types, an unstable intermediate state.

Implementation tasks (subagent-driven):

1. Rename `LayoutSpan` → `PretableRowRange` in `@pretable-internal/layout-core` + update internal consumers.
2. Rename `GridCore*` → `Pretable*` in `@pretable-internal/grid-core` + update internal consumers (including the test file).
3. Update `@pretable-internal/renderer-dom` imports.
4. Update `@pretable/react/src/types.ts` import (alias `PretableColumn as PretableBaseColumn`).
5. Define explicit `PretableGrid` interface in `@pretable/core/src/pretable-grid.ts`; rewrite `create-grid.ts` to return it.
6. Write `@pretable/core/src/public_api.ts` with TSDoc + `@public` tags; collapse `index.ts` to one line; collapse `types.ts` to clean re-exports.
7. Add `@pretable-internal/grid-core` and `@pretable-internal/layout-core` to `bundledPackages` in `api-extractor.base.json`. Flip `ae-missing-release-tag` to `warning`.
8. Regenerate `core.api.md` and `react.api.md`; verify react's diff is rename-only.
9. Write `packages/core/README.md`.
10. Repo-wide gates + PR.

## Success criteria

- `core.api.md` has zero `ae-forgotten-export` warnings.
- Every public symbol in `core.api.md` shows `@public` (not `@public (undocumented)`).
- `PretableGrid` is an explicit interface, not `extends Omit<…>`.
- `@pretable-internal/grid-core/src/types.ts` and `@pretable-internal/layout-core/src/types.ts` use only `Pretable*` names.
- `react.api.md` diff is mechanical rename only (no shape change).
- `packages/core/README.md` exists with the structure above.
- All repo-wide gates pass including `pnpm api:check`.
