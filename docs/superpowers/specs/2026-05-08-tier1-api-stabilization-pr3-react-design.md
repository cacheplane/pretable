# Tier 1 Sub-project A — PR 3 (`@pretable/react` audit) Design

> Status: spec. 2026-05-08. PR 3 of 5 in [Tier 1 Sub-project A — Public API Stabilization](2026-05-07-tier1-public-api-stabilization-design.md).

## Goal

Lock `@pretable/react`'s public surface for 1.0. Move to the `public_api.ts` convention, demote internal-leakage exports to `ɵ`-prefix, tag long-lived experimental surfaces `@beta`, fix one forgotten-export leak, retire one alias, rename the public hook to a brevity-favoring name, and TSDoc every public symbol with `@public`.

## Non-goals

- No `@pretable/ui` density consolidation. PR 4 owns the `useResolvedHeights` ↔ `getDensityHeights` decision; this PR keeps the React hook (now `ɵ`-prefixed) untouched in shape.
- No copy/clipboard docs page. Clipboard symbols stay `@public`; the docs alignment is captured in `project_clipboard_docs_followup.md` memory and ships in a later docs-pass session.
- No removal of headless types from react's re-export surface beyond what the rename ripple forces.
- No new tests beyond what the rename + TSDoc ripple requires.

## Architecture

### Public-surface layout

`@pretable/react/src/` becomes:

```
src/
  index.ts          // export * from './public_api';
  public_api.ts     // hand-curated re-exports, the entire public surface
  ...component / hook / helper files (internal)
```

`public_api.ts` is the only file whose contents are reviewed for public-API impact.

### Hook rename — brevity wins

The current public surface ships two hooks, naming-inverted from how docs talk:

- `usePretable(opts) → PretableGrid` — low-level (just memoizes `createGrid`).
- `usePretableModel(opts) → PretableModel` — full hook used by every doc and `PretableSurface` itself.

The fix:

- **Delete** the low-level `usePretable`. Its body is `useMemo(() => createGrid(opts), [opts])` — trivial to inline at call sites if anyone needs it.
- **Rename** `usePretableModel` → `usePretable`. The new `usePretable(opts: UsePretableOptions): PretableModel` is the only public hook.
- **Rename** `UsePretableModelOptions` → `UsePretableOptions`. The old `UsePretableOptions` (a strict subset) is deleted.

Net: the simple-sounding name is the one users actually want. Pre-1.0, no backcompat shim.

### Release tag policy

- `@public` — stable for 1.0. Includes components, the renamed `usePretable`, render-input/output types, props interfaces, clipboard helpers and types.
- `@beta` — `InspectionGrid`, `LabeledGridSurface`, and their `*Props` / `*FormatValueInput` types. Special-purpose surfaces with no docs page; we anticipate shape change.
- `@internal` (with `ɵ`-prefix at the public re-export site) — `useResolvedHeights`, `measureRenderedRowHeight`, `ROW_SELECT_COLUMN_ID`. Cross-package internal use is supported (the `@pretable-internal/*` packages or future internal hooks may reach for them); external consumers shouldn't.

The original symbol names stay clean inside the package; only the `public_api.ts` re-export wears the `ɵ`-prefix, e.g.,

```ts
export {
  useResolvedHeights as ɵuseResolvedHeights,
  measureRenderedRowHeight as ɵmeasureRenderedRowHeight,
  ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID,
} from "...";
```

### Forgotten-export fix

`PretableSurfaceSortDirection` currently leaks (an `ae-forgotten-export` warning in PR 2's regenerated `react.api.md`). It's a local `"asc" | "desc" | null` alias inside `pretable-surface.tsx` that escapes through a prop type. Resolution: replace it with the canonical `PretableSortDirection` re-exported from `@pretable/core`, then delete the local alias.

### Alias retirement

`PretableCoreColumn` was kept in PR 2 as a re-export alias (`export type { PretableColumn as PretableCoreColumn } from "@pretable/core"`) to preserve react's surface during the engine rename. PR 3 deletes it. Users consume `PretableColumn` from `@pretable/react` (the extended type with `format`/`render`); if they need the engine-only base, they import `PretableColumn` from `@pretable/core` directly.

## Components — full audit decisions

| Symbol                                                        | Decision                        | Notes                                                                                             |
| ------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Pretable`                                                    | `@public`                       | Wrapper around `PretableSurface`. Used in 4 website docs.                                         |
| `PretableSurface`                                             | `@public`                       | Primary controlled component.                                                                     |
| `InspectionGrid`                                              | `@beta`                         | Special-purpose surface; no docs page.                                                            |
| `LabeledGridSurface`                                          | `@beta`                         | Same.                                                                                             |
| `usePretable` (old, returns `PretableGrid`)                   | **Delete**                      | Trivial; inline `useMemo` at call sites.                                                          |
| `usePretableModel`                                            | **Rename → `usePretable`**      | Returns `PretableModel`.                                                                          |
| `useResolvedHeights`                                          | `ɵ`-prefix at re-export         | `@internal` tag on declaration.                                                                   |
| `measureRenderedRowHeight`                                    | `ɵ`-prefix at re-export         | `@internal` tag on declaration.                                                                   |
| `ROW_SELECT_COLUMN_ID`                                        | `ɵ`-prefix at re-export         | `@internal` tag on declaration.                                                                   |
| `defaultCoerceForCopy`                                        | `@public`                       | Per user feedback — clipboard story is stable.                                                    |
| `serializeRangesAsTsv`                                        | `@public`                       | Per user feedback.                                                                                |
| `CopyPayload`                                                 | `@public`                       | Per user feedback.                                                                                |
| `SerializeRangesArgs`                                         | `@public`                       | Per user feedback.                                                                                |
| `PretableColumn`                                              | `@public`                       | React-extended (with `format`/`render`); imports core's `PretableColumn` as `PretableBaseColumn`. |
| `PretableCoreColumn` (alias)                                  | **Delete**                      | Use `PretableColumn` from `@pretable/core` if the base is needed.                                 |
| `PretableSurfaceSortDirection` (leak)                         | **Delete**                      | Replace usage with `PretableSortDirection` from core.                                             |
| `PretableModel`                                               | `@public`                       | Hook output. TSDoc clarifies role.                                                                |
| `PretableRenderSnapshot`                                      | `@public`                       | Render-layout output. TSDoc clarifies role.                                                       |
| `PretableRenderRow`                                           | `@public`                       | Member of render snapshot.                                                                        |
| `PretableTelemetry`                                           | `@public`                       | Hook output.                                                                                      |
| `PretableSurfaceState`                                        | `@public`                       | **Input** (controlled state shape). TSDoc explicitly says "controlled state input".               |
| `PretableProps`                                               | `@public`                       | Component props.                                                                                  |
| `PretableSurfaceProps`                                        | `@public`                       | Component props.                                                                                  |
| `PretableSurfaceMessages`                                     | `@public`                       | i18n messages.                                                                                    |
| `RowSelectionColumnConfig`                                    | `@public`                       | Surface prop config.                                                                              |
| `InspectionGridProps`                                         | `@beta`                         | Tracks `InspectionGrid`.                                                                          |
| `LabeledGridSurfaceProps`                                     | `@beta`                         | Tracks `LabeledGridSurface`.                                                                      |
| `LabeledGridSurfaceFormatValueInput`                          | `@beta`                         | Tracks `LabeledGridSurface`.                                                                      |
| `PretableCellRenderInput`                                     | `@public`                       | Render-input shape.                                                                               |
| `PretableHeaderRenderInput`                                   | `@public`                       | Header render-input shape.                                                                        |
| `PretableFormatInput`                                         | `@public` (re-export from core) | Already `@public` in core.                                                                        |
| `UsePretableOptions` (renamed from `UsePretableModelOptions`) | `@public`                       | New canonical hook options.                                                                       |
| `DensityHeights`                                              | `@public`                       | Density type. PR 4 may consolidate the source-of-truth question.                                  |

Re-exports from `@pretable/core` continue to flow through react's public surface: `PretableGrid`, `PretableGridOptions`, `PretableGridSnapshot`, `PretableRow`. (No `PretableCoreColumn` re-export — deleted.)

## Data flow

1. Apply audit decisions in source files (rename, delete, demote, tag).
2. Update internal consumers (`pretable-surface.tsx`, test files, website docs).
3. Write `public_api.ts` listing every public + `ɵ`-prefixed symbol with TSDoc on declarations as needed.
4. Collapse `index.ts` to `export * from './public_api'`.
5. Regenerate `react.api.md`. The diff is substantial (rename + 5 demotions + 1 deletion + 4 `@beta` tags + many new TSDoc summaries) but bounded.
6. Verify all gates including bench (which uses `PretableSurface`, not the renamed hook — should pass without change).

## Error handling

- **Internal compile errors after rename.** Caught by `pnpm -w typecheck`. Fix inline.
- **Website docs broken by hook rename.** `apps/website` typecheck and the website's vitest tests catch this; the rename in `grid/index.mdx` (and any other doc using `usePretableModel`) is mechanical.
- **`react.api.md` shows unexpected new/removed symbols.** Audit the diff against this spec's table. Mismatch = bug.

## Testing

Repo-wide gates: `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w lint`, `pnpm format`, `pnpm api:check`. The two react test files (`pretable-surface.test.tsx`, `pretable.test.tsx`) need their `usePretableModel` → `usePretable` rename. No new test categories.

## Per-package README

`packages/react/README.md` ~80 lines:

- One-paragraph "what is `@pretable/react`" — the React surface for pretable.
- "When to use" — pick `<Pretable>` for drop-in, `<PretableSurface>` for controlled, the `usePretable` hook for custom rendering.
- Install + minimal `<Pretable>` example.
- "See [`react.api.md`](./react.api.md) for the full surface."
- License/contributing footer matching repo style.

## PR shape

Single PR. The rename is atomic — splitting would force website docs to compile against half-renamed hooks.

Implementation tasks (subagent-driven):

1. Hook rename: rewrite `use-pretable.ts` (delete old `usePretable`, rename `usePretableModel` → `usePretable`, rename options type); update `pretable-surface.tsx`; update 2 react test files.
2. Forgotten-export fix: replace `PretableSurfaceSortDirection` with `PretableSortDirection` re-export from core; delete the local alias.
3. Symbol audit: add `@public` / `@beta` / `@internal` TSDoc on every declaration in `pretable.tsx`, `pretable-surface.tsx`, `inspection-grid.tsx`, `labeled-grid-surface.tsx`, `density.ts`, `row-height.ts`, `copy.ts`, `constants.ts`, `use-pretable.ts`, `types.ts`.
4. Write `packages/react/src/public_api.ts` (curated re-exports, including `ɵ`-prefix renames at re-export site); collapse `index.ts` to one line; remove `PretableCoreColumn` re-export.
5. Update website docs: `apps/website/content/docs/grid/index.mdx` (rename `usePretableModel` → `usePretable`, `UsePretableModelOptions` → `UsePretableOptions`).
6. Regenerate `react.api.md`; audit the diff against this spec.
7. Write `packages/react/README.md`.
8. Repo-wide gates + PR.

## Success criteria

- `react.api.md` has zero `ae-forgotten-export` warnings.
- Every public symbol in `react.api.md` shows `@public` (not `@public (undocumented)`) at the type level. Member-level `(undocumented)` is acceptable.
- `@beta` annotation present on `InspectionGrid`, `LabeledGridSurface`, and their props/render-input types.
- Three new `ɵ`-prefixed exports in `react.api.md`: `ɵuseResolvedHeights`, `ɵmeasureRenderedRowHeight`, `ɵROW_SELECT_COLUMN_ID`. The non-prefixed names are gone.
- `usePretable` (returns `PretableModel`) is the only hook export; `usePretableModel` is gone.
- `PretableCoreColumn` and `PretableSurfaceSortDirection` are gone from `react.api.md`.
- `packages/react/README.md` exists with the structure above.
- All repo-wide gates pass.
