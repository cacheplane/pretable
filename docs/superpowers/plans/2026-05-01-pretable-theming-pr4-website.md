# Wire `apps/website` to `@pretable/ui` Implementation Plan (PR 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the embedded playground grid in `apps/website` to consume `@pretable/ui`'s Material 3 theme + grid.css. Replace the hand-rolled `[data-pretable-*]` selector block in `globals.css` with imports from the new theming package; activate Material's dark mode via `data-theme="dark"`; keep the InspectionGrid-specific `.inspection-*` rules (label/value sub-cell layout) as a local layer on top.

**Architecture:** Two CSS layers compose. The new lower layer (`@pretable/ui/themes/material.css` + `@pretable/ui/grid.css`) provides Material 3 dark theme tokens and selector-based skin for `[data-pretable-*]` data attributes. The local upper layer (existing `.inspection-*` class rules in `globals.css`) provides website-specific layout — label/value stacked inside each cell, monospace font, mobile-responsive grid. The result: the playground grid uses Material's surface tones, outline colors, and accent, while preserving the website's distinctive InspectionGrid layout and font choices.

**Tech Stack:** CSS only. No JS code changes. Adds `@pretable/ui` workspace dependency to `apps/website`.

**Spec:** [docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md](../specs/2026-05-01-pretable-theming-architecture-design.md) — see PR decomposition table, PR 4.

**Starting state:** Clean working tree on branch `feat/theming-pr4-website` based on `origin/main` at `db2c1e8` (PR 1, PR 2, PR 3 of the theming plan already merged via #46/#50/#54). Worktree at `/Users/blove/repos/pretable/.worktrees/theming-pr4-website`. Baseline: `pnpm --filter @pretable/app-website test` passes 51/51.

---

## Decisions baked in

- **Material 3 dark mode** — the website is dark-themed; setting `data-theme="dark"` on `<html>` activates Material's dark variant from `@pretable/ui/themes/material.css`.
- **Two-layer composition** — lower layer (Material tokens + grid.css) drives chrome (cell background, header, gridlines, focus, selection), upper layer (`.inspection-*` rules) drives InspectionGrid-specific layout.
- **Don't override Material tokens** — the playground demos Material's look. The website's brand identity is preserved in the marketing chrome around the grid (cool-slate page bg, hero section, etc.) which uses `--pt-*` tokens. The grid itself looks "Material" — that's a feature, advertising the theming flexibility.
- **Keep `.inspection-*` rules** — these style sub-cell layout (label above value, font, gap) that Material doesn't cover. Material's grid.css styles `[data-pretable-cell]`; the website's `.inspection-cell` class adds layout on top via specificity.
- **Drop the `#grid [data-pretable-*]` rules** — these duplicate what `@pretable/ui/grid.css` now provides. Keeping them would create override wars.
- **Existing tests stay green** — visual mismatch isn't asserted; structural tests (component renders, attributes present) pass regardless of theme.

---

## File structure

**Files MODIFIED:**

- `apps/website/package.json` — add `"@pretable/ui": "workspace:*"` to dependencies; add `pnpm --filter @pretable/ui build` to `prepare:deps` script
- `apps/website/app/globals.css` — replace the `#grid [data-pretable-*]` selector block (lines 81-92, 166-178 — the `viewport` and `[data-pinned/selected/focused]` rules) with `@import` lines for material.css and grid.css. Keep the `.inspection-*` block (lines 94-164, 180-192). Drop the `#grid [data-pretable-scroll-viewport]:focus-visible` rule because grid.css's focus handling is sufficient.
- `apps/website/app/layout.tsx` — add `data-theme="dark"` attribute to `<html>`

**Files NOT TOUCHED:**

- `apps/website/app/styles/cool-slate-tokens.css` — the website's local brand tokens (`--pt-*` namespace). Continues driving the marketing chrome. Independent of `--pretable-*`.
- `apps/website/app/styles/marketing-components.css` — Nav and Footer styling. Unrelated to grid theming.
- `apps/website/app/components/PlaygroundSection.tsx` — InspectionGrid usage unchanged.
- `apps/website/app/components/CodeExample.tsx` — pretable-react usage unchanged.
- All other website files — unaffected.

---

## Task 1: Add `@pretable/ui` workspace dependency

**Files:**

- Modify: `apps/website/package.json`

**Step 1: Read the current `apps/website/package.json` to confirm starting state.**

```bash
cat apps/website/package.json
```

Confirm:

- `dependencies` does NOT include `"@pretable/ui"` (was removed in PR 1)
- `scripts.prepare:deps` is `pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable/react build` (no `@pretable/ui` reference)

**Step 2: Add `@pretable/ui` to `dependencies` (alphabetically positioned among `@pretable/*` entries).**

The existing dependencies block has `"@pretable/react": "workspace:*"`. Insert `"@pretable/ui": "workspace:*"` AFTER it. Use the Edit tool:

- old_string: `    "@pretable/react": "workspace:*",`
- new_string:

```
    "@pretable/react": "workspace:*",
    "@pretable/ui": "workspace:*",
```

**Step 3: Add `@pretable/ui` to the `prepare:deps` script.**

The existing script ends with `&& pnpm --filter @pretable/react build`. Append `&& pnpm --filter @pretable/ui build`:

- old_string: `pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable/react build`
- new_string: `pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable/react build && pnpm --filter @pretable/ui build`

**Step 4: Verify the file is valid JSON.**

```bash
cat apps/website/package.json | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("OK")'
```

Expected: prints `OK`. If a JSON parse error fires, fix any trailing-comma issues.

**Step 5: Run `pnpm install` to update the lockfile.**

```bash
pnpm install
```

Expected: pnpm reports adding `@pretable/ui` to `apps/website`'s deps. The lockfile updates with the new workspace link entry.

**Step 6: Build the new workspace dependency tree to confirm `@pretable/ui` resolves.**

```bash
pnpm --filter @pretable/app-website... run prepare:deps
```

The `...` after `@pretable/app-website` is pnpm syntax for "this package and its dependencies." This should build `@pretable-internal/scenario-data`, `@pretable/react`, and `@pretable/ui` successfully.

Expected: all three packages build clean. If `@pretable/ui` build fails, the issue is upstream and not part of this PR — investigate before continuing.

**Step 7: Run prettier on package.json (in case of trailing-comma issues).**

```bash
pnpm exec prettier --write apps/website/package.json
```

**Step 8: Commit.**

```bash
git add apps/website/package.json pnpm-lock.yaml
git status --short
git commit -m "$(cat <<'EOF'
build(website): add @pretable/ui workspace dependency

Restores the dependency that PR 1 removed (when @pretable/ui still
held marketing components and cool-slate tokens). The new
@pretable/ui (created in PR 2) is a public theming package with
grid.css, theme files, density helpers, and a Tailwind v4 bridge.

Adds the dep to package.json, threads the build into prepare:deps
so apps/website builds resolve the new package's dist correctly.

Subsequent commits in this PR wire the actual CSS imports.

Part 1 of wiring apps/website to @pretable/ui (PR 4 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `@pretable/ui` CSS imports + Material dark mode + drop generic `[data-pretable-*]` rules

**Files:**

- Modify: `apps/website/app/globals.css`
- Modify: `apps/website/app/layout.tsx`

**Step 1: Read the current `apps/website/app/globals.css` to confirm starting state.**

```bash
cat apps/website/app/globals.css
```

Confirm:

- Lines 1-7: font imports + `cool-slate-tokens.css` + `marketing-components.css` + `tailwindcss`
- Lines 9-35: `@theme inline` block aliasing `--pt-*` to `--color-*`
- Lines 37-67: html/body resets
- Lines 81-92: `#grid [data-pretable-scroll-viewport]` rules — to be dropped
- Lines 94-164: `.inspection-*` rules — kept
- Lines 166-178: `#grid .inspection-cell[data-pinned/selected/focused]` rules — to be dropped (but the `.inspection-cell` rule on line 152 stays — it's keyed on the class, not the data attribute)
- Lines 180-192: `.inspection-cell-label` and `.inspection-cell-value` — kept
- Lines 194-215: marquee animation — unrelated, kept

**Step 2: Add the new imports near the top (after cool-slate, before tailwindcss).**

Use the Edit tool:

- old_string:

```
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
@import "./styles/cool-slate-tokens.css";
@import "./styles/marketing-components.css";
@import "tailwindcss";
```

- new_string:

```
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
@import "./styles/cool-slate-tokens.css";
@import "./styles/marketing-components.css";
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
@import "tailwindcss";
```

This adds Material tokens + grid.css to the cascade. They load AFTER cool-slate tokens (so `--pt-*` and `--pretable-*` coexist with no conflict) and BEFORE `tailwindcss` (so Tailwind doesn't see the new tokens at build time — that's fine; we don't need Tailwind utilities for `--pretable-*` here, and `@pretable/ui/tailwind.css` is opt-in for that).

**Step 3: Drop the `#grid [data-pretable-scroll-viewport]` rule block (lines 81-92 of original, including the focus-visible rule).**

Delete the following block from `globals.css`. Use the Edit tool:

- old_string:

```
/* InspectionGrid internals — these classes come from @pretable/react/internal */
#grid [data-pretable-scroll-viewport] {
  background: var(--pt-grid-bg);
  height: 460px;
  overflow: auto;
  position: relative;
  outline: none;
}

#grid [data-pretable-scroll-viewport]:focus-visible {
  box-shadow: inset 0 0 0 2px var(--pt-accent);
}

#grid .inspection-header-row {
```

- new_string:

```
/* InspectionGrid internals — these classes come from @pretable/react/internal.
   The [data-pretable-scroll-viewport] / [data-pinned] / [data-selected] /
   [data-focused] generic skin is now provided by @pretable/ui/grid.css.
   Rules below add InspectionGrid-specific layout (label/value stacked
   inside each cell, monospace font, grid layout for column alignment). */

/* Restore the playground's fixed viewport height — grid.css doesn't
   prescribe a height because that's a consumer layout choice. */
#grid [data-pretable-scroll-viewport] {
  height: 460px;
}

#grid .inspection-header-row {
```

This:

- Drops `background: var(--pt-grid-bg)` — `grid.css` sets `background: var(--pretable-bg-grid)` (Material `surface-container-low` in dark)
- Drops `overflow: auto`, `position: relative`, `outline: none` — these are engine-side inline styles already; the engine's layout-only `getViewportStyle` in `pretable-surface.tsx` handles them
- Drops the focus-visible box-shadow — `grid.css` handles focus via `outline` on cells; the viewport-level focus box-shadow was redundant
- KEEPS the `height: 460px` rule because that's a website-specific viewport height choice, not theming

**Step 4: Drop the `#grid .inspection-cell[data-pinned/selected/focused]` rules (lines 166-178 of original).**

Delete the data-attribute-keyed rules. Keep the `.inspection-cell` class rule on line 152.

- old_string:

```
#grid .inspection-cell[data-pinned="left"] {
  z-index: 3;
  background: var(--pt-grid-raised);
}

#grid .inspection-cell[data-selected="true"] {
  background: color-mix(in oklab, var(--pt-accent) 14%, var(--pt-grid-bg));
}

#grid .inspection-cell[data-focused="true"] {
  outline: 1px solid var(--pt-accent);
  outline-offset: -1px;
}

#grid .inspection-cell-label {
```

- new_string:

```
/* Pinned/selected/focused styling now provided by @pretable/ui/grid.css
   targeting the engine's [data-pinned] / [data-selected] / [data-focused]
   attributes directly. Removed website-local overrides. */

#grid .inspection-cell-label {
```

**Step 5: Add `data-theme="dark"` to the `<html>` element in `app/layout.tsx`.**

Open `apps/website/app/layout.tsx`. The current `<html>` element is `<html lang="en">`. Use the Edit tool:

- old_string: `    <html lang="en">`
- new_string: `    <html data-theme="dark" lang="en">`

This activates Material's dark variant: `[data-theme="dark"] { --pretable-bg-grid: #1d1b20; ... }` from `@pretable/ui/themes/material.css`.

**Step 6: Verify website build succeeds.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -10
```

Expected: Next.js production build completes. The build resolves the new `@pretable/ui/themes/material.css` and `@pretable/ui/grid.css` imports.

If the build fails with module resolution: confirm `@pretable/ui` was properly added in Task 1 step 5 (check `apps/website/node_modules/@pretable/ui` exists; if not, re-run `pnpm install`).

**Step 7: Verify website tests still pass.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -5
```

Expected: 51 tests pass (same baseline). The CSS changes don't affect structural tests; the `data-theme="dark"` attribute is non-functional in jsdom unless a test explicitly queries for it.

If a test fails: investigate. Tests that assert on layout-position math may need adjustment if Material's grid.css gives different padding than the dropped `.inspection-cell` rules.

**Step 8: Run prettier on the modified files.**

```bash
pnpm exec prettier --write apps/website/app/globals.css apps/website/app/layout.tsx
```

**Step 9: Verify website typecheck.**

```bash
pnpm --filter @pretable/app-website typecheck 2>&1 | tail -3
```

Expected: exit 0.

**Step 10: Commit.**

```bash
git add apps/website/app/globals.css apps/website/app/layout.tsx
git status --short
git commit -m "$(cat <<'EOF'
feat(website): wire embedded grid to @pretable/ui Material theme

Three changes to apps/website that consume the new theming package:

1. globals.css imports @pretable/ui/themes/material.css and
   @pretable/ui/grid.css (after cool-slate-tokens and before
   tailwindcss). Material 3 baseline scheme drives the grid's
   chrome — surface tones, outline colors, secondary-container
   selection, on-surface state layers.

2. layout.tsx adds data-theme="dark" to the <html> element. This
   activates Material's [data-theme="dark"] block, switching grid
   surfaces to surface-container-low (#1d1b20), text to on-surface
   light (#e6e0e9), and accent to dark-mode primary (#d0bcff).

3. globals.css drops the pre-PR4 #grid [data-pretable-*] rule
   block (viewport background, focus-visible box-shadow, pinned/
   selected/focused cell overrides) — all of these are now
   provided by @pretable/ui/grid.css targeting the same data
   attributes. KEEPS the InspectionGrid-specific .inspection-*
   class rules (label/value sub-cell layout, monospace font,
   grid layout for column alignment) which Material's grid.css
   doesn't cover.

Two namespaces coexist on the page: --pt-* (cool-slate, drives
marketing chrome), --pretable-* (Material, drives the embedded
grid). They don't conflict because they're prefix-disjoint.

The 460px viewport height is preserved as a single rule — that's
a website layout choice, not a theming concern.

Visual change is significant: the playground grid now uses
Material's purple primary (#d0bcff dark mode) instead of the
website's cyan accent, M3 surface tones instead of cool-slate
greys, and Material outlines for cell dividers. The change
demonstrates the theming flexibility of the package.

Part 2 of wiring apps/website to @pretable/ui (PR 4 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Final workspace verification

**Files:** none touched.

- [ ] **Step 1: Verify website tests pass.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -5
```

Expected: 51 tests pass.

- [ ] **Step 2: Verify website typecheck and build.**

```bash
pnpm --filter @pretable/app-website typecheck 2>&1 | tail -3
pnpm --filter @pretable/app-website build 2>&1 | tail -10
```

Both should be clean.

- [ ] **Step 3: Verify other apps and packages still pass.**

```bash
pnpm --filter @pretable/app-bench test 2>&1 | tail -3
pnpm --filter @pretable/react test 2>&1 | tail -3
pnpm --filter @pretable/ui test 2>&1 | tail -3
```

Expected: app-bench 52/52, react 50/50, ui 11/11.

- [ ] **Step 4: Verify workspace-wide typecheck.**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 5: Verify all touched files pass prettier.**

```bash
pnpm exec prettier --check apps/website/package.json apps/website/app/globals.css apps/website/app/layout.tsx
```

Expected: all three files compliant.

- [ ] **Step 6: Confirm clean working tree and full commit list.**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected status: clean. Expected log: 3 commits (plan + Task 1 + Task 2):

```
<sha> docs(plans): wire apps/website to @pretable/ui (PR 4 of theming plan)
<sha> build(website): add @pretable/ui workspace dependency
<sha> feat(website): wire embedded grid to @pretable/ui Material theme
```

(No commit for Task 3 — verification only.)

- [ ] **Step 7: Visual sanity check (optional but recommended).**

```bash
pnpm --filter @pretable/app-website dev
```

Open `http://localhost:3000` in a browser. The playground section should render with:

- Material dark surface tones (`#1d1b20` cell bg, `#211f26` header) — visibly different from the cool-slate page background
- Material primary purple accent (`#d0bcff`) for selected cells and focus rings
- M3 outlines (`#49454f`) for cell dividers
- Same InspectionGrid label/value sub-cell layout as before (monospace font, label uppercase + value below)

If the grid renders without theming (plain white-on-white or similar), the imports didn't take effect — investigate.

---

## Self-review checklist

After completing all tasks:

- [ ] `apps/website/package.json` lists `"@pretable/ui": "workspace:*"` in dependencies and references `@pretable/ui` in `prepare:deps` script.
- [ ] `apps/website/app/globals.css` has `@import "@pretable/ui/themes/material.css"` and `@import "@pretable/ui/grid.css"` immediately after the cool-slate imports.
- [ ] `apps/website/app/layout.tsx` has `data-theme="dark"` on `<html>`.
- [ ] `apps/website/app/globals.css` no longer has the `#grid [data-pretable-scroll-viewport]` background/overflow rules or the `[data-pinned/selected/focused]` rules.
- [ ] `apps/website/app/globals.css` STILL has `.inspection-cell`, `.inspection-row`, `.inspection-header-row`, `.inspection-header-cell`, `.inspection-cell-label`, `.inspection-cell-value` rules.
- [ ] `pnpm --filter @pretable/app-website test` passes 51/51.
- [ ] `pnpm --filter @pretable/app-website build` succeeds.
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm exec prettier --check` passes for all three modified files.
- [ ] The git history shows 2 implementation commits in a coherent narrative.

---

## What this PR does NOT do (deferred)

- **PR 5** — wire `apps/bench` grid to `@pretable/ui`'s Excel theme (different theme matches bench's technical/dense aesthetic; same shape as PR 4).
- **Rebrand the embedded grid to match cool-slate** — by spec, the playground grid intentionally shows Material to advertise the theming flexibility. If a future iteration wants the playground to use cool-slate-themed grid, that's a follow-up override (e.g., import a cool-slate theme file, or override `--pretable-accent` etc. at `:root`).
- **Visual regression tests** — deferred per spec section "Testing". The contract test in `@pretable/ui` catches token-shape regressions; visual differences are caught by manual review on this PR.
