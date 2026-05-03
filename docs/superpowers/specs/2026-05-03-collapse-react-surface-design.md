# Collapse `react-surface` into `@pretable/react` — Design

**Status:** Approved
**Date:** 2026-05-03

## Problem

The React layer is split across two workspace packages:

- **`@pretable/react`** (public, npm) — exports `<Pretable>` plus re-exports of hooks (`usePretable`, `usePretableModel`, `useResolvedHeights`), helpers (`measureRenderedRowHeight`), and types.
- **`@pretable-internal/react-surface`** (private, `workspace:*`) — owns `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>` plus their props types, plus internal-only `rendering.ts` and `styles.ts`.

The split was a hedge during the npm publishing pipeline work — keep the seam private until we know the shape works. Five months of dogfooding later (website hero grid, bench harness, public adapter), the shape is stable. The split now creates real cost without offsetting benefit:

- Two packages to build, lint, test, typecheck, and ship-gate.
- Imports in the website + bench cross a private/public boundary that exists for no consumer reason.
- npm consumers see `<Pretable>` (a 115-line opinionated wrapper with hardcoded `viewportHeight={320}` and hardcoded cell renderers) and nothing else. The kitchen-sink component the website + bench use is locked away.
- The "wedge integrity" claim — "what we measure is what you ship" — relies on a private package and is harder to explain.

## Goal

Collapse `react-surface` into `@pretable/react`. After this change:

- One package owns the React layer.
- `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>` become public exports of `@pretable/react`.
- The `<Pretable>` opinionated preset stays as a friendly default.
- The website + bench import only from `@pretable/react`.
- `packages/react-surface/` is deleted.
- The website + bench dogfood the same public API external users install.

## Decisions (locked)

1. **Promote all 3 components to public:** `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>` and their props types. The hooks and model types are already public via re-exports today; we just stop the re-export hop and own them directly.
2. **Keep `<Pretable>` as a preset.** It's a friendly default. Doc'd as "batteries-included opinionated wrapper around `<PretableSurface>`." `<InspectionGrid>` and `<LabeledGridSurface>` are siblings in the preset tier.
3. **`interactionState` prop on `<PretableSurface>` stays public, marked `@experimental`.** Bench uses it for plan replay; advanced users may want it. JSDoc signals "subject to change."
4. **No subpath exports.** Single entry. Tree-shaking already works (ESM + `sideEffects: false`). Revisit if real-world bundle complaints surface.
5. **Internal-only files stay internal.** `rendering.ts` (helpers like `getPinnedLeftOffsets`) and `styles.ts` are not exported from the package's `index.ts`. They live in `packages/react/src/` but aren't part of the public contract.

## Architecture after collapse

```
packages/react/
├── src/
│   ├── index.ts                  ← public exports
│   ├── pretable.tsx              ← <Pretable> preset
│   ├── pretable-surface.tsx      ← <PretableSurface> (kitchen sink)
│   ├── inspection-grid.tsx       ← <InspectionGrid> preset
│   ├── labeled-grid-surface.tsx  ← <LabeledGridSurface> preset
│   ├── use-pretable.ts           ← usePretable, usePretableModel + types
│   ├── density.ts                ← useResolvedHeights
│   ├── row-height.ts             ← measureRenderedRowHeight
│   ├── rendering.ts              ← (internal) helpers, NOT exported from index
│   ├── styles.ts                 ← (internal) constants/helpers, NOT exported
│   └── __tests__/
└── (tsup, package.json updated)

packages/react-surface/   ← DELETED
```

### Public exports from `@pretable/react`

```ts
// Components
export { Pretable } from "./pretable";
export { PretableSurface } from "./pretable-surface";
export { InspectionGrid } from "./inspection-grid";
export { LabeledGridSurface } from "./labeled-grid-surface";

// Hooks
export { usePretable, usePretableModel } from "./use-pretable";
export { useResolvedHeights } from "./density";

// Helpers
export { measureRenderedRowHeight } from "./row-height";

// Component prop types
export type { PretableProps } from "./pretable";
export type { PretableSurfaceProps } from "./pretable-surface";
export type { InspectionGridProps } from "./inspection-grid";
export type {
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Hook + model types
export type {
  PretableModel,
  PretableRenderRow,
  PretableRenderSnapshot,
  PretableTelemetry,
  UsePretableModelOptions,
  UsePretableOptions,
} from "./use-pretable";

// Density
export type { DensityHeights } from "./density";

// Re-exports from @pretable/core (unchanged)
export type {
  PretableColumn,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";
```

### `@experimental` JSDoc additions

On `<PretableSurface>`'s `interactionState` prop:

```ts
/**
 * @experimental
 *
 * Inject deterministic sort/filter/selection/focus state. Used internally
 * by the bench harness for plan replay; exposed for advanced consumers
 * who need to drive the grid from external state. Shape may change
 * across minor releases.
 */
interactionState?: PretableInteractionState | null;
```

## Consumers of the new package

After collapse, three consumers all use `@pretable/react`:

1. **`apps/website`** — `<HeroGrid>` imports `<PretableSurface>` from `@pretable/react`.
2. **`apps/bench`** — `<PretableAdapter>` and any other adapters import from `@pretable/react`.
3. **External npm consumers** — `npm install @pretable/react`, get the same components.

The wedge integrity claim becomes: **"the website + bench dogfood the same public API."**

## Migration mechanics

This is a 0.x package. We're at 0.0.1. No external lock-in. Land as a single PR with a changeset bumping to **0.1.0** ("all internal grid components now exported publicly; `react-surface` workspace package removed").

The changes are:

1. Move 8 source files from `packages/react-surface/src/` to `packages/react/src/` (keeping their internal cross-imports as relative paths).
2. Move `__tests__/` along with them.
3. Move `packages/react-surface/src/__tests__/*` tests if any.
4. Update `packages/react/src/index.ts` to export the moved components + props types directly (no re-exports through `@pretable-internal/react-surface`).
5. Update `packages/react/src/pretable.tsx` to import `<PretableSurface>` from `./pretable-surface` (relative).
6. Update `packages/react/package.json`:
   - Drop `@pretable-internal/react-surface` from `devDependencies`.
   - Add the deps that `react-surface` had: `@pretable-internal/scenario-data`, `@pretable-internal/renderer-dom` (devDependencies, since tsup inlines via `dts: { resolve: true }`).
   - Update `build` script to drop the `pnpm --filter @pretable-internal/react-surface build &&` chain.
   - Same for `test`, `typecheck`.
7. Update `packages/react/tsup.config.ts` if it references react-surface in `noExternal`.
8. Update `packages/react/tsconfig.build.json` if it references react-surface.
9. Update consumers — drop `@pretable-internal/react-surface` from package.jsons and replace imports:
   - `apps/website/package.json` (drop dep)
   - `apps/website/app/components/HeroGrid.tsx`: `from "@pretable-internal/react-surface"` → `from "@pretable/react"`
   - `apps/bench/package.json` (drop dep)
   - `apps/bench/src/{pretable-adapter,bench-app,bench-runtime}.{ts,tsx}` and tests — same swap
   - `apps/streaming-demo/package.json` and `apps/streaming-demo/src/components/streaming-grid.tsx` — same swap
10. Delete `packages/react-surface/` (`git rm -rf`).
11. Add a changeset (`.changeset/<random>.md`) with a major bump for `@pretable/react` (still 0.x — minor bump in semver per 0.x rules, or use `major` field in changeset and let it become 0.1.0):
    ```
    ---
    "@pretable/react": minor
    ---

    Internal `react-surface` workspace package collapsed into `@pretable/react`.
    All grid components (`<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>`)
    are now exported directly. The opinionated `<Pretable>` preset stays.
    ```
12. Run all gates:
    - `pnpm install --frozen-lockfile`
    - `pnpm -r build`
    - `pnpm typecheck`
    - `pnpm lint`
    - `pnpm format`
    - `pnpm test`
    - `pnpm build`
    - `pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging`
13. Open PR, merge on green.

## Verification

- All existing unit tests pass (the test files move with their components).
- The website's `<HeroGrid>` renders identically (same component, different import path).
- The bench's `<PretableAdapter>` renders identically and produces the same telemetry.
- `publint --strict` and `attw --pack` pass on the new shape of `@pretable/react`.
- Smoke tests on the production deploy after merge.

## Out of scope

- Renaming `<Pretable>` or `<PretableSurface>`. Names stay.
- Subpath exports. Stay single-entry.
- Refactoring `<PretableSurface>`'s internal architecture. Pure structural collapse.
- Promoting `rendering.ts` helpers to public API. Internal stays internal.

## Risks

- **API lock-in on previously-internal types.** `PretableSurfaceProps`, `InspectionGridProps`, `LabeledGridSurfaceProps` are now part of the npm contract. Mitigated by: (a) we just released 0.0.1, no external consumers yet; (b) `@experimental` JSDoc on `interactionState`; (c) honest semver going forward.
- **Bigger bundle for `<Pretable>`-only users.** Today they only pay for `<Pretable>`'s wrapper. After collapse, they pay for the whole package because everything is in one entry. Mitigated by ESM tree-shaking — anything they don't import gets dropped. We confirmed this works in the publint/attw checks.
