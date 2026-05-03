# Collapse `react-surface` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Move all files from `packages/react-surface/` into `packages/react/`, update all consumers, delete the old package, ship as a single PR.

**Architecture:** Single workspace package `@pretable/react` owns the React layer. `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>` become public exports.

**Spec:** `docs/superpowers/specs/2026-05-03-collapse-react-surface-design.md`
**Branch:** `feat/collapse-react-surface` (created)

---

## Task 1 — Move source files

**Files moved (preserving filenames):**

```
packages/react-surface/src/pretable-surface.tsx     → packages/react/src/pretable-surface.tsx
packages/react-surface/src/inspection-grid.tsx      → packages/react/src/inspection-grid.tsx
packages/react-surface/src/labeled-grid-surface.tsx → packages/react/src/labeled-grid-surface.tsx
packages/react-surface/src/use-pretable.ts          → packages/react/src/use-pretable.ts
packages/react-surface/src/density.ts               → packages/react/src/density.ts
packages/react-surface/src/row-height.ts            → packages/react/src/row-height.ts
packages/react-surface/src/rendering.ts             → packages/react/src/rendering.ts
packages/react-surface/src/styles.ts                → packages/react/src/styles.ts
packages/react-surface/src/__tests__/*              → packages/react/src/__tests__/*
```

**Steps:**

- [ ] **1.1** Use `git mv` so history is preserved:

  ```bash
  for f in pretable-surface.tsx inspection-grid.tsx labeled-grid-surface.tsx use-pretable.ts density.ts row-height.ts rendering.ts styles.ts; do
    git mv packages/react-surface/src/$f packages/react/src/$f
  done

  mkdir -p packages/react/src/__tests__
  for f in $(ls packages/react-surface/src/__tests__/ 2>/dev/null); do
    git mv packages/react-surface/src/__tests__/$f packages/react/src/__tests__/$f
  done
  ```

  Both directories may have an existing `__tests__/`. If `packages/react/src/__tests__/` already has files, the for-loop won't conflict (different filenames). If a name collision exists, stop and merge content manually.

- [ ] **1.2** Verify no files left under `packages/react-surface/src/` except `index.ts` (which we'll delete in Task 5):

  ```bash
  ls packages/react-surface/src/
  ```

- [ ] **1.3** Internal imports between the moved files use relative paths (e.g. `./use-pretable`, `./density`) — these don't change because all files moved together. Verify with:

  ```bash
  grep -n "from \"\\./" packages/react/src/*.ts packages/react/src/*.tsx | head -20
  ```

  None of those should reference `@pretable-internal/react-surface`.

- [ ] **1.4** Search for any external `@pretable-internal/react-surface` imports inside the moved files (none expected, but verify):

  ```bash
  grep -n "@pretable-internal/react-surface" packages/react/src/
  ```

  Should return nothing.

- [ ] **1.5** Commit:

  ```bash
  git add -A
  git commit -m "refactor(react): move react-surface source files into @pretable/react"
  ```

## Task 2 — Update `@pretable/react` index

**File:** `packages/react/src/index.ts`

Replace contents with:

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

// Re-exports from @pretable/core
export type {
  PretableColumn,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";
```

**Steps:**

- [ ] **2.1** Inspect current `packages/react/src/pretable.tsx` — it imports `PretableSurface` from `@pretable-internal/react-surface`. Change that import to `from "./pretable-surface"`. Also export `PretableProps` if not already exported (check the file; the spec assumes `PretableProps` is exported).

- [ ] **2.2** Write the new `packages/react/src/index.ts` (overwrite with the contents above).

- [ ] **2.3** Run typecheck:

  ```bash
  pnpm --filter @pretable/react typecheck
  ```

  If `PretableProps` isn't exported from `pretable.tsx`, add `export interface PretableProps {...}` (it's likely already there as `interface PretableProps` — promote to `export interface PretableProps`).

- [ ] **2.4** Commit:

  ```bash
  git add packages/react/src/index.ts packages/react/src/pretable.tsx
  git commit -m "feat(react): consolidate exports — components + hooks + types"
  ```

## Task 3 — Add `@experimental` JSDoc on `interactionState`

**File:** `packages/react/src/pretable-surface.tsx`

Locate the `interactionState` field on `PretableSurfaceProps`. Add JSDoc immediately above it:

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

(The exact type name may differ — `PretableInteractionOverrides` per `use-pretable.ts`. Use whatever the actual prop type is.)

**Steps:**

- [ ] **3.1** `grep -n "interactionState" packages/react/src/pretable-surface.tsx` to find the prop.

- [ ] **3.2** Add the JSDoc above it.

- [ ] **3.3** Commit:

  ```bash
  git add packages/react/src/pretable-surface.tsx
  git commit -m "docs(react): mark interactionState prop as @experimental"
  ```

## Task 4 — Update `packages/react/package.json` and tsup config

**File:** `packages/react/package.json`

Current state (relevant fields):

```json
"devDependencies": {
  "@pretable-internal/react-surface": "workspace:*",
  "@pretable-internal/scenario-data": "workspace:*",
  "@pretable-internal/renderer-dom": "workspace:*"
},
"scripts": {
  "build": "pnpm --filter @pretable-internal/react-surface build && pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsup",
  ...
  "test": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && pnpm --filter @pretable-internal/react-surface build && vitest run --environment jsdom",
  "typecheck": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && pnpm --filter @pretable-internal/react-surface build && tsc -p tsconfig.typecheck.json --noEmit"
}
```

Target:

```json
"devDependencies": {
  "@pretable-internal/grid-core": "workspace:*",
  "@pretable-internal/scenario-data": "workspace:*",
  "@pretable-internal/renderer-dom": "workspace:*"
},
"scripts": {
  "build": "pnpm --filter @pretable-internal/grid-core build && pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsup",
  ...
  "test": "pnpm --filter @pretable-internal/grid-core build && pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && vitest run --environment jsdom",
  "typecheck": "pnpm --filter @pretable-internal/grid-core build && pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/renderer-dom build && pnpm --filter @pretable/core build && tsc -p tsconfig.typecheck.json --noEmit"
}
```

**Note:** `@pretable-internal/grid-core` is added because `react-surface` previously had it as a transitive dep. Verify by reading `packages/react-surface/package.json` and copying its `devDependencies`/`dependencies` (minus `@pretable-internal/react-surface` itself, which doesn't exist anymore).

**Steps:**

- [ ] **4.1** Read `packages/react-surface/package.json` to identify exact deps:

  ```bash
  cat packages/react-surface/package.json
  ```

- [ ] **4.2** Read current `packages/react/package.json`:

  ```bash
  cat packages/react/package.json
  ```

- [ ] **4.3** Update `packages/react/package.json`:
  - Drop `@pretable-internal/react-surface` from `devDependencies`.
  - Add any missing deps from `react-surface`'s `dependencies`/`devDependencies` to `react`'s `devDependencies` (since `tsup` inlines via `dts: { resolve: true }`).
  - Update `build`/`test`/`typecheck` scripts to drop the `@pretable-internal/react-surface build` step.

- [ ] **4.4** Inspect `packages/react/tsup.config.ts` for any reference to `@pretable-internal/react-surface` (e.g. in `noExternal`). If present, replace with the deps it represented (`@pretable-internal/grid-core`, `@pretable-internal/scenario-data`, `@pretable-internal/renderer-dom`).

  ```bash
  cat packages/react/tsup.config.ts
  ```

- [ ] **4.5** Inspect `packages/react/tsconfig.build.json` for `paths` mapping or `references` to react-surface. Update.

  ```bash
  cat packages/react/tsconfig.build.json
  ```

- [ ] **4.6** Inspect `packages/react/tsconfig.json` and `tsconfig.typecheck.json` for path mappings:

  ```bash
  cat packages/react/tsconfig.json
  cat packages/react/tsconfig.typecheck.json 2>/dev/null
  ```

  If they have a `paths` entry like `"@pretable-internal/react-surface": ["../react-surface/src/index.ts"]`, drop it.

- [ ] **4.7** Commit:

  ```bash
  git add packages/react/package.json packages/react/tsup.config.ts packages/react/tsconfig*.json
  git commit -m "build(react): swap react-surface dep for its underlying internal deps"
  ```

## Task 5 — Delete `packages/react-surface/`

- [ ] **5.1** Verify nothing else references it now:

  ```bash
  grep -rln "@pretable-internal/react-surface" packages/ apps/ --include="*.ts" --include="*.tsx" --include="*.json" 2>/dev/null
  ```

  Should still match `apps/website`, `apps/bench`, `apps/streaming-demo`, and possibly `packages/react/tsconfig.build.json` (we'll fix in Task 6 + 7).

- [ ] **5.2** Delete the package:

  ```bash
  git rm -rf packages/react-surface
  ```

- [ ] **5.3** Inspect `pnpm-workspace.yaml` for an explicit listing of `react-surface` (probably uses globs, so no entry to remove):

  ```bash
  cat pnpm-workspace.yaml
  ```

- [ ] **5.4** Don't commit yet — Tasks 6/7 will need to fix consumers, then we'll regen the lockfile.

## Task 6 — Update consumer apps

**Files (apply the same swap to each):**

- `apps/website/app/components/HeroGrid.tsx`
- `apps/bench/src/pretable-adapter.tsx`
- `apps/bench/src/bench-app.tsx`
- `apps/bench/src/bench-runtime.ts`
- `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- `apps/streaming-demo/src/components/streaming-grid.tsx`

For each: replace `from "@pretable-internal/react-surface"` with `from "@pretable/react"`. Keep the imported names identical.

`apps/website/package.json`, `apps/bench/package.json`, `apps/streaming-demo/package.json`:
- Drop `@pretable-internal/react-surface` from `dependencies`.
- Verify `@pretable/react` is already listed (should be — check first).

**Steps:**

- [ ] **6.1** Replace imports in source files:

  ```bash
  for f in \
    apps/website/app/components/HeroGrid.tsx \
    apps/bench/src/pretable-adapter.tsx \
    apps/bench/src/bench-app.tsx \
    apps/bench/src/bench-runtime.ts \
    apps/bench/src/__tests__/pretable-adapter.test.tsx \
    apps/streaming-demo/src/components/streaming-grid.tsx; do
    sed -i.bak 's|@pretable-internal/react-surface|@pretable/react|g' "$f" && rm "$f.bak"
  done
  ```

- [ ] **6.2** Verify no stale references:

  ```bash
  grep -rln "@pretable-internal/react-surface" apps/ --include="*.ts" --include="*.tsx" 2>/dev/null
  ```

  Should be empty.

- [ ] **6.3** Update `apps/website/package.json`, `apps/bench/package.json`, `apps/streaming-demo/package.json`:
  - Drop `"@pretable-internal/react-surface": "workspace:*"` from `dependencies`.
  - Verify `"@pretable/react": "workspace:*"` is already in `dependencies`. If not, add it.

- [ ] **6.4** Run `pnpm install` to regenerate lockfile:

  ```bash
  pnpm install
  ```

- [ ] **6.5** Commit Tasks 5 + 6 together (because lockfile churn references both):

  ```bash
  git add -A
  git commit -m "refactor(consumers): point website + bench + streaming-demo at @pretable/react"
  ```

## Task 7 — Verify all gates green

- [ ] **7.1** Build all packages from scratch:

  ```bash
  pnpm -r build
  ```

  All workspaces must build. If `@pretable/react` build fails complaining about missing deps, revisit Task 4.

- [ ] **7.2** Typecheck:

  ```bash
  pnpm typecheck
  ```

- [ ] **7.3** Lint:

  ```bash
  pnpm lint
  ```

  Fix any errors. Warnings on pre-existing fast-refresh stay.

- [ ] **7.4** Format:

  ```bash
  pnpm format
  ```

  If unclean, `pnpm format:write` then re-check.

- [ ] **7.5** Tests:

  ```bash
  pnpm test
  ```

- [ ] **7.6** Build (root, includes website Next build):

  ```bash
  pnpm build
  ```

- [ ] **7.7** Packaging gates:

  ```bash
  pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging
  ```

- [ ] **7.8** If any format/lint changes were needed, commit:

  ```bash
  git add -A
  git commit -m "chore(react): format + lint pass post-collapse"
  ```

  (Skip if no changes.)

## Task 8 — Add changeset

**File:** new `.changeset/<random-name>.md`

```bash
cat > .changeset/collapse-react-surface.md <<'EOF'
---
"@pretable/react": minor
---

Internal `react-surface` workspace package collapsed into `@pretable/react`.
All grid components are now exported directly from the public package:

- `<PretableSurface>` — the kitchen-sink grid component
- `<InspectionGrid>` — preset for inspection-style data
- `<LabeledGridSurface>` — preset with labeled cells

The opinionated `<Pretable>` preset stays. The `interactionState` prop on
`<PretableSurface>` is marked `@experimental` — bench-internal feature
exposed for advanced consumers, shape may change.
EOF
```

- [ ] **8.1** Run the heredoc above.

- [ ] **8.2** Commit:

  ```bash
  git add .changeset/collapse-react-surface.md
  git commit -m "changeset: collapse react-surface into @pretable/react"
  ```

## Task 9 — Open PR + merge on green

- [ ] **9.1** Push:

  ```bash
  git push -u origin feat/collapse-react-surface
  ```

- [ ] **9.2** Open PR with title:
  `refactor(react): collapse internal react-surface into @pretable/react`

  Body:
  - Brief summary
  - List of decisions (locked items from spec)
  - Verification matrix (gates, packaging)
  - Note that 0.1.0 will publish on next release

- [ ] **9.3** Watch CI: `gh pr checks <num> --watch`.

- [ ] **9.4** Merge: `gh pr merge <num> --squash --delete-branch`.

- [ ] **9.5** Confirm production deploy + smoke pass against pretable.ai.
