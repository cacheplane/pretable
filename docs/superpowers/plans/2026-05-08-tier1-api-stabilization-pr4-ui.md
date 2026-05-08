# Tier 1 Sub-project A — PR 4 (`@pretable/ui` audit + density consolidation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@pretable/ui` the single source of truth for `getDensityHeights` and the `DensityHeights` type. Tag UI's surface `@public` with TSDoc, write the per-package README that documents the CSS classname / variable / entrypoint contract, refactor `@pretable/react`'s `useResolvedHeights` to wrap UI's function, and delete React's now-redundant local impl.

**Architecture:** Three logical changes happen in one PR — UI surface annotation (TSDoc + `public_api.ts`), React density refactor (delete duplicates, wrap UI), README + regenerate `.api.md`. The consolidation is atomic because splitting would force `@pretable/react` to compile against a half-migrated UI package.

**Tech Stack:** TypeScript, React 18+, `@microsoft/api-extractor`, `@microsoft/tsdoc`, pnpm workspaces, vitest.

**Source spec:** `docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr4-ui-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `packages/ui/src/density.ts` | Canonical `getDensityHeights` + `DensityHeights` | Modify (defensive guard + TSDoc + `@public`) |
| `packages/ui/src/public_api.ts` | **NEW** curated public surface | Create |
| `packages/ui/src/index.ts` | Package entry | Modify (collapse to `export * from './public_api'`) |
| `packages/ui/README.md` | **NEW** per-package README documenting CSS contract | Create |
| `packages/react/src/density.ts` | React density story | Rewrite (delete local impl/type/parsePx/FALLBACK_*; `useResolvedHeights` wraps UI's function) |
| `packages/react/src/public_api.ts` | React public surface | Modify (re-export `DensityHeights` from `@pretable/ui` instead of local) |
| `packages/react/package.json` | React deps | Modify (add `@pretable/ui: workspace:*` to `dependencies`) |
| `packages/ui/ui.api.md` | Generated baseline | Regenerate (annotation-only diff) |
| `packages/react/react.api.md` | Generated baseline | Regenerate (`DensityHeights` now bundled-from-UI; impl differences invisible to report) |

---

## Task 1: UI density helper — defensive guard + TSDoc + `@public`

**Files:**
- Modify: `packages/ui/src/density.ts`

The current UI `getDensityHeights` lacks the defensive `getPropertyValue` guard that React's impl has (needed because some test environments mock `getComputedStyle` with plain objects that don't implement `getPropertyValue`). Pulling the guard into UI is part of the consolidation.

- [ ] **Step 1: Replace ALL contents of `packages/ui/src/density.ts`**

```ts
const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

/**
 * Density-related heights (in CSS pixels) read from the active theme.
 *
 * @public
 */
export interface DensityHeights {
  rowHeight: number;
  headerHeight: number;
}

function parsePx(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Synchronous snapshot of the resolved density-related CSS variables on
 * `document.documentElement`.
 *
 * Returns `{ rowHeight, headerHeight }` parsed from `--pretable-row-height`
 * and `--pretable-header-height`. Falls back to 32 / 36 when a variable is
 * unset, empty, or not parseable as a `<number>px` value.
 *
 * SSR-safe: returns the fallback values when `document` is undefined.
 *
 * For non-React consumers, tests, custom virtualizers, and power users.
 * The reactive React hook (`useResolvedHeights`) lives in `@pretable/react`.
 *
 * @public
 */
export function getDensityHeights(): DensityHeights {
  if (typeof document === "undefined") {
    return {
      rowHeight: FALLBACK_ROW_HEIGHT,
      headerHeight: FALLBACK_HEADER_HEIGHT,
    };
  }
  const styles = getComputedStyle(document.documentElement);
  // Defensive: some test environments mock getComputedStyle with plain
  // objects that don't implement getPropertyValue. Treat that as "unset"
  // and fall back, instead of throwing.
  const read = (name: string): string => {
    if (typeof styles?.getPropertyValue !== "function") return "";
    return styles.getPropertyValue(name);
  };
  return {
    rowHeight: parsePx(read("--pretable-row-height")) ?? FALLBACK_ROW_HEIGHT,
    headerHeight:
      parsePx(read("--pretable-header-height")) ?? FALLBACK_HEADER_HEIGHT,
  };
}
```

- [ ] **Step 2: Verify UI typecheck + tests still pass**

```bash
pnpm --filter @pretable/ui typecheck && pnpm --filter @pretable/ui test
```

Expected: typecheck clean, all 5 density tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/density.ts
git commit -m "feat(ui): TSDoc + @public on getDensityHeights and DensityHeights; defensive getPropertyValue guard

Adds the defensive read() guard so jsdom mocks that lack
getPropertyValue() don't throw — matches the pattern that previously
lived in @pretable/react's parallel impl. Existing density tests pass
unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: UI `public_api.ts`; collapse `index.ts`

**Files:**
- Create: `packages/ui/src/public_api.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Create `packages/ui/src/public_api.ts`**

```ts
/**
 * Public API of `@pretable/ui`. Hand-curated re-exports — do not edit
 * `index.ts` directly.
 *
 * @packageDocumentation
 */

export { getDensityHeights, type DensityHeights } from "./density";
```

- [ ] **Step 2: Replace `packages/ui/src/index.ts` with one line**

```ts
export * from "./public_api";
```

- [ ] **Step 3: Verify typecheck and tests**

```bash
pnpm --filter @pretable/ui typecheck && pnpm --filter @pretable/ui test
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/public_api.ts packages/ui/src/index.ts
git commit -m "feat(ui): hand-curated public_api.ts; collapse index.ts to one line

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: React density refactor — delete local impl, wrap UI

**Files:**
- Modify: `packages/react/src/density.ts`
- Modify: `packages/react/package.json` (add `@pretable/ui` dependency)

The current React `density.ts` declares its own `DensityHeights`, its own `getDensityHeights`, its own `parsePx`, and `FALLBACK_*` constants. After this task, only `useResolvedHeights` survives in React's `density.ts` — and it wraps UI's `getDensityHeights` via `useSyncExternalStore`. The `DensityHeights` type comes from `@pretable/ui`. The React-local `HEADER_HEIGHT` import (the legacy 52 fallback) is dropped here; `styles.ts` keeps its own use of `HEADER_HEIGHT` separately and is unaffected.

- [ ] **Step 1: Add `@pretable/ui` to `@pretable/react`'s `dependencies`**

In `packages/react/package.json`, locate the `dependencies` block (currently only has `@pretable/core: workspace:*`) and add `@pretable/ui`. Final `dependencies`:

```json
"dependencies": {
  "@pretable/core": "workspace:*",
  "@pretable/ui": "workspace:*"
},
```

Then run `pnpm install` from the worktree root so the workspace symlink is created.

- [ ] **Step 2: Replace ALL contents of `packages/react/src/density.ts`**

```ts
import { useCallback, useRef, useSyncExternalStore } from "react";

import {
  type DensityHeights,
  getDensityHeights,
} from "@pretable/ui";

export type { DensityHeights };

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density", "data-theme", "class", "style"],
  });
  return () => observer.disconnect();
}

/**
 * React hook returning the current density heights derived from the
 * active CSS theme. Internal — `<Pretable>` and `<PretableSurface>` use
 * this; external consumers should reach for `getDensityHeights` from
 * `@pretable/ui`.
 *
 * @internal
 */
export function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): DensityHeights {
  // useSyncExternalStore requires snapshot getters to return stable
  // references when the underlying values haven't changed. Cache the
  // last-returned object per-hook-instance and return it as-is when the
  // resolved values would be identical, preventing infinite re-render loops.
  const cachedClient = useRef<DensityHeights | null>(null);
  const cachedServer = useRef<DensityHeights | null>(null);

  const getSnapshot = useCallback(() => {
    const css = getDensityHeights();
    const rowHeight = rowHeightProp ?? css.rowHeight;
    const headerHeight = headerHeightProp ?? css.headerHeight;
    const prev = cachedClient.current;
    if (
      prev !== null &&
      prev.rowHeight === rowHeight &&
      prev.headerHeight === headerHeight
    ) {
      return prev;
    }
    const next = { rowHeight, headerHeight };
    cachedClient.current = next;
    return next;
  }, [rowHeightProp, headerHeightProp]);

  const getServerSnapshot = useCallback(() => {
    const css = getDensityHeights();
    const rowHeight = rowHeightProp ?? css.rowHeight;
    const headerHeight = headerHeightProp ?? css.headerHeight;
    const prev = cachedServer.current;
    if (
      prev !== null &&
      prev.rowHeight === rowHeight &&
      prev.headerHeight === headerHeight
    ) {
      return prev;
    }
    const next = { rowHeight, headerHeight };
    cachedServer.current = next;
    return next;
  }, [rowHeightProp, headerHeightProp]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

Note: server snapshot also calls `getDensityHeights` — UI's impl is SSR-safe (returns 32/36 fallback when `document === undefined`).

- [ ] **Step 3: Verify React typecheck + tests**

```bash
pnpm --filter @pretable/ui build && \
pnpm --filter @pretable/react typecheck && \
pnpm --filter @pretable/react test
```

Expected: clean. The UI build is needed first because react now imports from UI's built dist via the workspace setup.

If any react test fails because it expected the old fallback header height of 52, the test was depending on the transitional bandaid. Update the test to expect 36 (matches the new `getDensityHeights` fallback).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/density.ts packages/react/package.json pnpm-lock.yaml
git commit -m "refactor(react): density helper now wraps @pretable/ui's getDensityHeights

Deletes React's local copy of getDensityHeights, DensityHeights, parsePx,
and the FALLBACK_* constants — they now live canonically in @pretable/ui.
useResolvedHeights becomes a thin useSyncExternalStore wrapper around
UI's function. The transitional 52 header fallback is dropped; UI's 36
default takes over (matches tokens.css).

Adds @pretable/ui to @pretable/react's runtime dependencies.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: React `public_api.ts` — re-export `DensityHeights` from UI

**Files:**
- Modify: `packages/react/src/public_api.ts`

React's `public_api.ts` currently re-exports `DensityHeights` from `./density`. After Task 3 that file re-exports from `@pretable/ui`, but it's cleaner to source the public re-export directly from UI in the curated public surface so the dependency is explicit.

- [ ] **Step 1: Update the `DensityHeights` re-export**

Find this line in `packages/react/src/public_api.ts`:

```ts
// Density
export type { DensityHeights } from "./density";
```

Replace with:

```ts
// Density (canonical home is @pretable/ui)
export type { DensityHeights } from "@pretable/ui";
```

- [ ] **Step 2: Verify typecheck and rebuild**

```bash
pnpm --filter @pretable/react build && \
pnpm --filter @pretable/react typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/public_api.ts
git commit -m "refactor(react): public_api re-exports DensityHeights from @pretable/ui directly

Makes the canonical-home dependency explicit at the public-surface
boundary instead of routing through ./density.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Write `packages/ui/README.md`

**Files:**
- Create: `packages/ui/README.md`

- [ ] **Step 1: Write the README**

```markdown
# @pretable/ui

CSS theme + a small JS helper for [pretable](https://pretable.dev/). Pair with [`@pretable/react`](../react) for the full surface, or use the JS helper standalone in non-React adapters.

## Install

```sh
npm install @pretable/ui
# or pnpm add @pretable/ui, yarn add @pretable/ui
```

## Minimal usage

Import the CSS once at the root of your app:

```ts
import "@pretable/ui/grid.css";
```

Optionally layer a theme:

```ts
import "@pretable/ui/themes/excel.css";
import "@pretable/ui/grid.css";
```

For tailwind users, swap `grid.css` for `tailwind.css` (both work; `tailwind.css` reads from your tailwind tokens).

## CSS API (v1 contract)

`@pretable/ui` ships five CSS entrypoints. Their selectors and CSS variables form the v1 styling contract — pretable's React components (`<Pretable>`, `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>`) emit the data attributes these stylesheets target.

### Entrypoints

- `@pretable/ui/grid.css` — the default styles. Imports `tokens.css`. Use this in a vanilla CSS or Sass setup.
- `@pretable/ui/tailwind.css` — same grid styles authored against tailwind tokens. Use this in a tailwind app.
- `@pretable/ui/tokens.css` — the CSS-variable definitions only. Imported by `grid.css` automatically; use directly only when you want tokens without grid styles.
- `@pretable/ui/themes/excel.css` — Excel-flavored theme. Layer on top of `grid.css`.
- `@pretable/ui/themes/material.css` — Material-flavored theme. Layer on top of `grid.css`.

### Density CSS variables

The two density-related variables `getDensityHeights()` reads:

| Variable | Default (in `tokens.css`) | Purpose |
|---|---|---|
| `--pretable-row-height` | `32px` | Body row height. |
| `--pretable-header-height` | `36px` | Header row height. |

The full token set lives in [`src/tokens.css`](./src/tokens.css). Override any token at `:root` or on a scoped element to change the look.

### Data-attribute hooks

Pretable surfaces emit a stable set of data attributes on rendered DOM. The CSS files in this package target them; your custom styles can too. The full set lives in `grid.css` — common ones include `[data-pretable-cell]`, `[data-pretable-row]`, `[data-pretable-header]`, `[data-pretable-cell-focused]`, and `[data-pretable-cell-selected]`. Renaming or removing these attributes is a breaking change.

## JS API

```ts
import { getDensityHeights } from "@pretable/ui";

const { rowHeight, headerHeight } = getDensityHeights();
```

`getDensityHeights()` is a synchronous snapshot of `--pretable-row-height` and `--pretable-header-height` on `document.documentElement`, with fallbacks of 32 / 36. SSR-safe (returns fallback values when `document` is undefined).

See **[`ui.api.md`](./ui.api.md)** for the generated public-API report.

## License

MIT — see [LICENSE](../../LICENSE).
```

- [ ] **Step 2: Verify the README's links**

```bash
ls packages/ui/src/tokens.css && ls packages/ui/src/grid.css
```

Both exist. The README references `./src/tokens.css` and links to `./ui.api.md` (regenerated in Task 6).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/README.md
git commit -m "docs(ui): add per-package README with CSS contract documentation

Documents the five CSS entrypoints, density variables, data-attribute
hooks, and JS surface as the v1 contract. Treats classname / variable
renames as breaking changes post-1.0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Regenerate `ui.api.md` and `react.api.md`; audit

**Files:**
- Modify: `packages/ui/ui.api.md`
- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Build the affected packages**

```bash
pnpm --filter @pretable/ui build && \
pnpm --filter @pretable/react build
```

Expected: both succeed.

- [ ] **Step 2: Regenerate**

```bash
pnpm api
```

Expected: all four packages report `API Extractor completed successfully`.

- [ ] **Step 3: Audit `ui.api.md`**

```bash
head -20 packages/ui/ui.api.md
grep -n "(undocumented)" packages/ui/ui.api.md | head
```

Expected: `// @public` annotation on both `getDensityHeights` and `DensityHeights` (no `(undocumented)` at the type level — member-level fields like `rowHeight` and `headerHeight` may show `(undocumented)`, that's acceptable).

- [ ] **Step 4: Audit `react.api.md`**

```bash
git diff packages/react/react.api.md | head -80
```

Expected: `DensityHeights` interface still appears, sourced via `bundledPackages` from `@pretable/ui` instead of from React's local declaration. Same struct (`{ rowHeight: number; headerHeight: number; }`) so the line-level appearance should be nearly identical.

If `useResolvedHeights` (or `ɵuseResolvedHeights`) shape changed in any unintended way, STOP — investigate.

- [ ] **Step 5: Run all four `api:check`**

```bash
pnpm api:check
```

Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/ui.api.md packages/react/react.api.md
git commit -m "chore(api): regenerate .api.md after density consolidation

ui.api.md: getDensityHeights and DensityHeights now annotated @public
with TSDoc. react.api.md: DensityHeights bundled-from-UI in the report.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Repo-wide gates and PR

**Files:** none (verification + push + PR creation)

- [ ] **Step 1: Run all repo-wide gates**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format && pnpm api:check
```

Expected: every command exits 0. If `pnpm format` warns about files (the spec/plan markdown), run `pnpm format:write` and amend the most recent commit (or add a small format-pass commit).

- [ ] **Step 2: Sanity check the PR scope**

```bash
git diff main..HEAD --stat | tail -10
```

Expected: changes confined to `packages/ui/`, `packages/react/src/density.ts`, `packages/react/src/public_api.ts`, `packages/react/package.json`, `packages/react/react.api.md`, `pnpm-lock.yaml`, and the spec/plan docs. No bench changes, no website changes (the website docs PR 3 already updated weren't touched here), no engine changes.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin api-stabilization-ui
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "refactor(ui): audit @pretable/ui; consolidate density helper as canonical home" --body "$(cat <<'EOF'
## Summary

PR 4 of 5 for [Tier 1 Sub-project A — Public API Stabilization](docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md). Audits \`@pretable/ui\` per [PR 4's design spec](docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr4-ui-design.md).

- **\`@pretable/ui\` becomes the single source of truth** for \`getDensityHeights\` and \`DensityHeights\`. Defensive \`getPropertyValue\` guard moved into UI's impl. Header-height fallback settles at **36** (matches \`tokens.css\`); React's transitional 52 dropped.
- **\`@pretable/react\`'s \`density.ts\` slims down** — local \`getDensityHeights\`, \`DensityHeights\`, \`parsePx\`, and \`FALLBACK_*\` constants deleted. \`useResolvedHeights\` (still \`@internal\`, \`ɵ\`-prefixed publicly) becomes a thin \`useSyncExternalStore\` wrapper around UI's function.
- **\`@pretable/ui\` added to \`@pretable/react\`'s runtime dependencies.**
- **\`public_api.ts\` convention** for UI; \`index.ts\` is one line. \`@public\` TSDoc on every UI symbol.
- **\`packages/ui/README.md\`** documents the CSS contract (5 entrypoints, density variables, data-attribute hooks) as part of the v1 API.
- **\`react.api.md\`** still exposes \`DensityHeights\`; the type is bundled-from-UI in the report.

## Behavior change to flag

The header-height fallback when no theme is loaded changes from 52 to 36 — purely the consequence of consolidating on UI's existing default. No app in this repo is unmigrated; \`apps/website\` and \`apps/bench\` both load \`grid.css\` and override the relevant variables. External consumers were not yet shipping pre-1.0.

## Test plan
- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` clean (UI density tests + React tests still pass)
- [x] \`pnpm -w lint\` clean
- [x] \`pnpm format\` clean
- [x] \`pnpm api:check\` clean (all 4 packages)
- [x] \`ui.api.md\` shows \`@public\` on \`getDensityHeights\` and \`DensityHeights\`
- [x] \`react.api.md\` still exposes \`DensityHeights\` (sourced from UI)
- [x] No website / bench code changes — pure refactor

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Set auto-merge**

```bash
gh pr merge --auto --squash
```

---

## Self-review checklist

- **Spec coverage:** UI audit (TSDoc + `@public`) = Tasks 1, 2. Density consolidation = Task 3 (and Task 4 for the public-surface re-export). Per-package README = Task 5. `.api.md` regen = Task 6. Gates + PR = Task 7. Every spec requirement maps to a task.
- **Placeholder scan:** no `TBD`, `TODO`, "implement later", or "etc." in any task body.
- **Type/name consistency:** `DensityHeights` and `getDensityHeights` are the only public names; both consistent across Tasks 1, 2, 3, 4, 6. The `useResolvedHeights` hook keeps its name (and stays `@internal` / `ɵ`-prefixed at the public boundary — that's PR 3's contract, unchanged here).
- **Note on Task 3 Step 3:** if React tests fail with `expected 52, got 36`, the fix is in the test — pre-1.0, fallback values are an implementation detail, not a contract.
