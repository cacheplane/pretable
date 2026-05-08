# Tier 1 Sub-project A — PR 4 (`@pretable/ui` audit + density consolidation) Design

> Status: spec. 2026-05-08. PR 4 of 5 in [Tier 1 Sub-project A — Public API Stabilization](2026-05-07-tier1-public-api-stabilization-design.md).

## Goal

Lock `@pretable/ui`'s public surface and resolve the density-helper duplication that PR 3 deferred. After PR 4, `@pretable/ui` is the single source of truth for `getDensityHeights` and the `DensityHeights` type; `@pretable/react` consumes both from `@pretable/ui`. The CSS classname contract is documented in `packages/ui/README.md` and treated as part of the v1 API.

## Non-goals

- No CSS rename / reshape / theme overhaul. The classnames currently in `grid.css` and `themes/*.css` are the v1 contract; PR 4 documents them, doesn't change them.
- No new themes. The two existing themes (`excel.css`, `material.css`) ship as-is.
- No tailwind-plugin work. `tailwind.css` is documented as the tailwind entrypoint; reshaping its API is out of scope.
- No removal of `HEADER_HEIGHT` from `@pretable/react`. It's used by `styles.ts` as an internal styling constant — a separate concern from the density helpers.

## Architecture

### Public-surface layout

`@pretable/ui/src/` becomes:

```
src/
  index.ts          // export * from './public_api';
  public_api.ts     // hand-curated re-exports (getDensityHeights, DensityHeights)
  density.ts        // the canonical impl
  ...CSS files (grid.css, tailwind.css, tokens.css, themes/*.css)
```

`public_api.ts` is the only file whose contents are reviewed for public-API impact.

### Density consolidation — option A

**`@pretable/ui` becomes the single source of truth.**

- `getDensityHeights` and `DensityHeights` live in `packages/ui/src/density.ts` only.
- The defensive `getPropertyValue` guard (currently in `@pretable/react`'s impl, needed for jsdom mocks) moves into UI's impl.
- The header-height fallback settles at **36** (UI's current tokens.css default). The transitional 52 in React's impl is dropped — pre-1.0, all apps in the repo load a theme.
- `@pretable/react`:
  - Deletes its local `getDensityHeights`, `DensityHeights`, `parsePx`, and `FALLBACK_*` constants.
  - `useResolvedHeights` (re-exported as `ɵuseResolvedHeights`) becomes a thin `useSyncExternalStore` subscriber wrapping `@pretable/ui`'s `getDensityHeights`.
  - Imports `DensityHeights` from `@pretable/ui` and re-exports it through `public_api.ts` so `@pretable/react`'s public surface still exposes the type.
  - Adds `@pretable/ui` to its `dependencies` in `package.json` (it's currently NOT a dep — react was carrying its own density story).
- Tests:
  - UI's existing density tests stay as the authoritative behavioral suite.
  - React's density-related tests (in `pretable.test.tsx` and `pretable-surface.test.tsx`) keep working because `useResolvedHeights` still returns the same shape; only the underlying implementation moved.

### Release tag policy

Both UI exports are `@public`:

- `getDensityHeights` — synchronous CSS-token reader.
- `DensityHeights` — `{ rowHeight, headerHeight }`.

No `@beta` or `@internal` candidates in this package's JS surface.

### CSS classnames as part of the v1 contract

`packages/ui/README.md` documents:

- The CSS variables (the full set documented in `tokens.css`; `--pretable-row-height` and `--pretable-header-height` are the density-related ones) as the theming API.
- The data-attribute hooks (`[data-pretable-cell]`, `[data-pretable-row]`, `[data-pretable-header]`, and related markers emitted by `@pretable/react`) as the styling API.
- The five entrypoints (`grid.css`, `tailwind.css`, `tokens.css`, `themes/excel.css`, `themes/material.css`) and what each ships.

Renaming or removing any of those is a **breaking change** post-1.0; pre-1.0 we're free but should treat it as a real cost.

## Components — full audit decisions

| Symbol / artifact | Decision | Notes |
|---|---|---|
| `getDensityHeights` (UI) | `@public` + TSDoc + defensive guard | Becomes canonical. |
| `DensityHeights` (UI) | `@public` + TSDoc | Becomes canonical type. |
| `getDensityHeights` (React) | **Delete** | Re-route through UI. |
| `DensityHeights` (React) | **Delete declaration**, re-export from UI | React still exposes the type via `public_api.ts`. |
| `parsePx` (React) | **Delete** | UI has its own. |
| React's `FALLBACK_HEADER_HEIGHT` (52) | **Delete** | UI's 36 wins. |
| `useResolvedHeights` (React, `ɵ`-prefixed publicly) | Refactor to wrap UI's `getDensityHeights` | Hook signature unchanged — only internals move. |
| `HEADER_HEIGHT` constant (React's `rendering.ts`) | **Keep** | Used by `styles.ts`; separate from density story. |
| `grid.css`, `tailwind.css`, `tokens.css` | Documented in README | Names locked. |
| `themes/excel.css`, `themes/material.css` | Documented in README | Names locked. |
| Tailwind entry semantics | Documented in README | Names locked. |

## Data flow

1. Move the defensive `getPropertyValue` guard from React's `density.ts` into UI's `density.ts`.
2. Add TSDoc + `@public` tags on UI's `getDensityHeights` and `DensityHeights` declarations.
3. Add `@pretable/ui` to `@pretable/react`'s `dependencies` in `package.json`.
4. Rewrite `packages/react/src/density.ts`: delete the local impl + type + constants; refactor `useResolvedHeights` to wrap UI's function via `useSyncExternalStore`.
5. Update `@pretable/react`'s `public_api.ts` to re-export `DensityHeights` from `@pretable/ui` instead of from `./density`.
6. Write `packages/ui/src/public_api.ts`; collapse `packages/ui/src/index.ts` to one line.
7. Write `packages/ui/README.md` with the CSS contract documentation.
8. Regenerate `ui.api.md` and `react.api.md`. UI's diff is annotation-only (`@public` documented). React's diff: `DensityHeights` now bundled-from-UI instead of local; impl differences in `useResolvedHeights` invisible to the report (function bodies don't appear).
9. Verify all gates including bench (which imports `@pretable/ui`'s CSS only, no JS).

## Error handling

- **React tests fail because density.ts changed shape.** Caught by `pnpm -w test`. UI's defensive guard prevents the jsdom mock issue.
- **Header-height behavior change in unmigrated apps.** No app in this repo is unmigrated (apps/website + apps/bench both load themes). External consumers were not yet shipping pre-1.0, so this is internal-only.
- **`react.api.md` shows `DensityHeights` as inlined-from-UI but with a different shape.** Both packages have the same struct (`{ rowHeight: number; headerHeight: number; }`) — the bundled report will look identical to before, just sourced from UI.

## Testing

Repo-wide gates: `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w lint`, `pnpm format`, `pnpm api:check`.

UI's existing density.test.ts continues to be the authoritative behavioral suite. React's tests touching `useResolvedHeights` (in `pretable.test.tsx`) should still pass without changes — only the underlying impl moves.

No new test categories.

## Per-package README

`packages/ui/README.md` ~120 lines:

- One-paragraph "what is `@pretable/ui`" — CSS theme + a small JS helper (`getDensityHeights`).
- "When to use" — pair with `@pretable/react` for full surface; or use the JS helper standalone in non-React adapters.
- Install + minimal usage (import the CSS at root, optionally import a theme).
- "CSS API" section documenting:
  - Five entrypoints (`grid.css`, `tailwind.css`, `tokens.css`, `themes/excel.css`, `themes/material.css`).
  - CSS variables (`--pretable-row-height`, `--pretable-header-height`, others as documented in `tokens.css`).
  - Data-attribute hooks (`[data-pretable-*]`) as styling extension points.
- "JS API" section pointing to `ui.api.md`.
- License + contributing footer.

## PR shape

Single PR. The consolidation is atomic — splitting would force `@pretable/react` to compile against a half-migrated UI surface.

Implementation tasks (subagent-driven):

1. UI audit: TSDoc + `@public` on `getDensityHeights` and `DensityHeights`; move the defensive `getPropertyValue` guard from React's impl into UI's.
2. UI public_api.ts move; collapse index.ts.
3. React density refactor: delete local impl/type/constants; rewrite `useResolvedHeights` to wrap UI's function; add `@pretable/ui` to react's deps.
4. React `public_api.ts` update: re-export `DensityHeights` from `@pretable/ui` instead of `./density`.
5. Write `packages/ui/README.md`.
6. Regenerate `ui.api.md` and `react.api.md`; audit the diff.
7. Repo-wide gates + PR.

## Success criteria

- `packages/ui/ui.api.md` shows `getDensityHeights` and `DensityHeights` as `@public` (not `(undocumented)`).
- `packages/react/src/density.ts` has no `getDensityHeights` declaration, no `parsePx`, no `FALLBACK_*` constants.
- `packages/react/src/density.ts`'s `useResolvedHeights` imports from `@pretable/ui`.
- `packages/react/package.json` has `@pretable/ui` in `dependencies`.
- `react.api.md` still exports `DensityHeights` (sourced from UI now).
- UI's density.test.ts still passes; React's `useResolvedHeights`-related tests still pass.
- `packages/ui/README.md` documents the CSS classname / variable / entrypoint contract.
- `pnpm api:check` clean for all 4 packages.
- All repo-wide gates pass.
