# Wire `apps/bench` to `@pretable/ui` Excel Theme Implementation Plan (PR 5 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the bench's pretable adapter grid to consume `@pretable/ui`'s Excel theme + grid.css. The bench is the benchmarking tool — Excel's gray, dense, technical aesthetic suits it. After this PR, the full theming arc lands and `@pretable/ui` is in production use by both internal apps.

**Architecture:** Smaller scope than PR 4. Bench has zero `[data-pretable-*]` selector rules in its CSS (verified via grep), so there's no slim or override to manage — Material's grid.css from `@pretable/ui` cascades through cleanly to the engine's data attributes. Only changes: add the workspace dependency, import the Excel theme + grid.css. Bench's pretable adapter renders `PretableSurface` directly (no `InspectionGrid` wrapper, no `.inspection-*` classes). Light mode (Excel is light-only by design — no `data-theme="dark"`).

**Tech Stack:** CSS only. No JS code changes. Adds `@pretable/ui` workspace dependency to `apps/bench`.

**Spec:** [docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md](../specs/2026-05-01-pretable-theming-architecture-design.md) — see PR decomposition table, PR 5.

**Starting state:** Clean working tree on branch `feat/theming-pr5-bench` based on `origin/main` at `d66c34d` (PR 1, PR 2, PR 3, PR 4 of the theming plan already merged via #46/#50/#54/#55). Worktree at `/Users/blove/repos/pretable/.worktrees/theming-pr5-bench`. Baseline: `pnpm --filter @pretable/app-bench test` passes 52/52.

---

## Decisions baked in

- **Excel theme** — bench's purpose is benchmarking; Excel's dense, technical, gray aesthetic suits a tool that displays data + metrics. Default density (compact, 20px rows) maximizes information density on screen.
- **Light mode** — Excel is light-only by design. Bench's surrounding UI is cool-slate dark, so the Excel-light grid will be visually contrasting (light grid embedded in dark surrounding chrome). Visual contrast is intentional — it advertises the theming flexibility.
- **No `.inspection-*` slim needed** — bench has no engine-attribute-targeting CSS to slim. Verified via `grep "data-pretable\|pretable" apps/bench/src/app.css` returning empty.
- **`.viewport-card` outer wrapper preserved** — this is the cool-slate-themed container around the grid, not the grid itself. The pretable scroll viewport (Excel-themed) renders inside the card. The visual sandwich (cool-slate card → Excel grid) is intentional, demonstrating the per-component theming.
- **Bench's other adapters (Grid Alpha, GridGamma, GridBeta) are unaffected** — they use their own theming systems.

---

## File structure

**Files MODIFIED:**

- `apps/bench/package.json` — add `"@pretable/ui": "workspace:*"` to dependencies; add `pnpm --filter @pretable/ui build` to `prepare:deps` script
- `apps/bench/src/app.css` — add `@import "@pretable/ui/themes/excel.css"` and `@import "@pretable/ui/grid.css"` between cool-slate-tokens.css/marketing-components.css and tailwindcss imports

**Files NOT TOUCHED:**

- `apps/bench/src/styles/cool-slate-tokens.css` — bench's local brand tokens. Continues driving the surrounding chrome.
- `apps/bench/src/styles/marketing-components.css` — Nav and Footer styling. Unaffected.
- `apps/bench/src/pretable-adapter.tsx` — renders `PretableSurface` directly, no styling changes needed.
- `apps/bench/src/bench-app.tsx` — the `<div className="viewport-card">` wrapper around the grid stays as-is.
- All other bench files — unaffected.

---

## Task 1: Add `@pretable/ui` workspace dependency

**Files:**

- Modify: `apps/bench/package.json`

**Step 1: Read the current `apps/bench/package.json` to confirm starting state.**

```bash
cat apps/bench/package.json
```

Confirm:

- `dependencies` does NOT include `"@pretable/ui"` (was removed in PR 1)
- `scripts.prepare:deps` does NOT reference `@pretable/ui` (was removed in PR 1)

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

- old_string: `pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/bench-runner build && pnpm --filter @pretable-internal/stream-adapter build && pnpm --filter @pretable/react build`
- new_string: `pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/bench-runner build && pnpm --filter @pretable-internal/stream-adapter build && pnpm --filter @pretable/react build && pnpm --filter @pretable/ui build`

**Step 4: Verify the file is valid JSON.**

```bash
cat apps/bench/package.json | node -e 'JSON.parse(require("fs").readFileSync(0, "utf8")); console.log("OK")'
```

Expected: prints `OK`.

**Step 5: Run `pnpm install` to update the lockfile.**

```bash
pnpm install
```

Expected: pnpm reports adding `@pretable/ui` to `apps/bench`'s deps. Lockfile updates.

**Step 6: Build the new workspace dependency tree to confirm `@pretable/ui` resolves.**

```bash
pnpm --filter @pretable/app-bench... run prepare:deps
```

Expected: builds the upstream packages including `@pretable/ui` successfully.

**Step 7: Run prettier on package.json.**

```bash
pnpm exec prettier --write apps/bench/package.json
```

**Step 8: Commit.**

```bash
git add apps/bench/package.json pnpm-lock.yaml
git status --short
git commit -m "$(cat <<'EOF'
build(bench): add @pretable/ui workspace dependency

Restores the dependency that PR 1 removed (when @pretable/ui still
held marketing components and cool-slate tokens). The new
@pretable/ui (created in PR 2) is a public theming package with
grid.css, theme files, density helpers, and a Tailwind v4 bridge.

Adds the dep to package.json, threads the build into prepare:deps
so apps/bench builds resolve the new package's dist correctly.

Subsequent commit in this PR wires the actual CSS imports.

Part 1 of wiring apps/bench to @pretable/ui (PR 5 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Import Excel theme + grid.css in `app.css`

**Files:**

- Modify: `apps/bench/src/app.css`

Adds two `@import` lines between cool-slate-tokens / marketing-components and tailwindcss. Excel theme (light-only, default density compact) writes the `--pretable-*` namespace at `:root`; grid.css targets the engine's `[data-pretable-*]` data attributes. Together they fully theme the bench's pretable adapter grid.

No `data-theme` attribute on `<html>` — Excel is light-only by design.

- [ ] **Step 1: Read the current `apps/bench/src/app.css` to confirm starting state.**

```bash
cat apps/bench/src/app.css
```

Confirm lines 1-7 are:

```css
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
@import "./styles/cool-slate-tokens.css";
@import "./styles/marketing-components.css";
@import "tailwindcss";
```

**Step 2: Add the new imports between cool-slate-tokens and tailwindcss.**

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
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
@import "tailwindcss";
```

This adds Excel tokens + grid.css to the cascade. They load AFTER cool-slate (so `--pt-*` and `--pretable-*` coexist) and BEFORE `tailwindcss` (Tailwind v4 doesn't need to see `--pretable-*` here; the grid.css selectors handle the styling).

**Step 3: Verify bench builds.**

```bash
pnpm --filter @pretable/app-bench build 2>&1 | tail -10
```

Expected: Vite production build completes. The build resolves the new `@pretable/ui/themes/excel.css` and `@pretable/ui/grid.css` imports.

If the build fails with module resolution: confirm `@pretable/ui` was properly added in Task 1 step 5 (check `apps/bench/node_modules/@pretable/ui` exists; if not, re-run `pnpm install`).

**Step 4: Verify bench tests still pass.**

```bash
pnpm --filter @pretable/app-bench test 2>&1 | tail -5
```

Expected: 52 tests pass (same baseline). The CSS changes don't affect structural tests.

**Step 5: Verify bench typecheck.**

```bash
pnpm --filter @pretable/app-bench typecheck 2>&1 | tail -3
```

Expected: exit 0.

**Step 6: Run prettier on the modified file.**

```bash
pnpm exec prettier --write apps/bench/src/app.css
```

**Step 7: Commit.**

```bash
git add apps/bench/src/app.css
git commit -m "$(cat <<'EOF'
feat(bench): wire pretable adapter grid to @pretable/ui Excel theme

Two import lines in apps/bench/src/app.css between cool-slate-tokens
and tailwindcss:

- @pretable/ui/themes/excel.css — Excel theme tokens at :root.
  Light-only by design; default density compact (20px rows, 15px
  Aptos Narrow font, Excel-green #107C41 accent, no row hover,
  sharp 0-radius corners). Bench is a benchmarking tool — Excel's
  dense/technical aesthetic suits it.

- @pretable/ui/grid.css — selector-based grid skin targeting the
  engine's [data-pretable-*] data attributes. With the engine's
  inline styles skin-stripped in PR 3, the grid renders unthemed
  until a theme + grid.css are loaded; this commit completes the
  bench's pretable adapter visual setup.

Two namespaces coexist on the page: --pt-* (cool-slate, drives
bench chrome — hero, scenario panels, telemetry surfaces),
--pretable-* (Excel, drives the embedded pretable adapter grid).
They don't conflict because they're prefix-disjoint.

No data-theme="dark" — Excel is light-only. Bench's surrounding
chrome stays cool-slate dark, the pretable adapter grid renders
Excel-light. The visual contrast advertises the per-component
theming flexibility of @pretable/ui.

The bench's other adapters (Grid Alpha, GridGamma, GridBeta) are unaffected
— they use their own theming systems.

Part 2 of wiring apps/bench to @pretable/ui (PR 5 of theming plan).
This completes the 5-PR theming arc.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Final workspace verification

**Files:** none touched.

- [ ] **Step 1: Verify bench tests pass.**

```bash
pnpm --filter @pretable/app-bench test 2>&1 | tail -3
```

Expected: 52 tests pass.

- [ ] **Step 2: Verify other apps and packages still pass.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -3
pnpm --filter @pretable/react test 2>&1 | tail -3
pnpm --filter @pretable/ui test 2>&1 | tail -3
```

Expected: app-website 51/51, react 50/50, ui 11/11.

- [ ] **Step 3: Verify workspace-wide typecheck.**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 4: Verify build.**

```bash
pnpm build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Verify all touched files pass prettier.**

```bash
pnpm exec prettier --check apps/bench/package.json apps/bench/src/app.css
```

Expected: both files compliant.

- [ ] **Step 6: Confirm clean working tree and full commit list.**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected status: clean. Expected log: 3 commits (plan + Task 1 + Task 2):

```
<sha> docs(plans): wire apps/bench to @pretable/ui (PR 5 of theming plan)
<sha> build(bench): add @pretable/ui workspace dependency
<sha> feat(bench): wire pretable adapter grid to @pretable/ui Excel theme
```

(No commit for Task 3 — verification only.)

- [ ] **Step 7: Visual sanity check (optional but recommended).**

```bash
pnpm --filter @pretable/app-bench dev
```

Open the bench in a browser. Switch to the pretable adapter. The grid should render with:

- White cell backgrounds (`#FFFFFF`)
- Excel green accent (`#107C41`) for sort indicator + focus rings
- Light gray gridlines (`#D4D4D4`)
- Light gray header strip (`#F3F3F3`)
- 20px row height (Excel compact default)
- Aptos Narrow / Segoe UI font in cells, 15px

The surrounding `.viewport-card` wrapper still uses cool-slate dark gray (the bench's chrome theme). The contrast is intentional — Excel-light grid embedded in a dark bench panel, demonstrating per-component theming.

If the grid renders without theming (plain unstyled), the imports didn't take effect — investigate.

The bench's other adapters (Grid Alpha, GridGamma, GridBeta) should render unchanged with their own theming.

---

## Self-review checklist

After completing all tasks:

- [ ] `apps/bench/package.json` lists `"@pretable/ui": "workspace:*"` in dependencies and references `@pretable/ui` in `prepare:deps` script.
- [ ] `apps/bench/src/app.css` has `@import "@pretable/ui/themes/excel.css"` and `@import "@pretable/ui/grid.css"` immediately after the cool-slate / marketing-components imports.
- [ ] `pnpm --filter @pretable/app-bench test` passes 52/52.
- [ ] `pnpm --filter @pretable/app-bench build` succeeds.
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm exec prettier --check` passes for both modified files.
- [ ] The git history shows 2 implementation commits in a coherent narrative.
- [ ] No `data-theme` attribute added (Excel is light-only).

---

## What this PR does NOT do

- **Customize Excel for bench's specific needs** — bench gets vanilla Excel theme. If a future iteration wants a denser Excel-like theme tuned for bench's data-density needs, that's a follow-up override at `:root` (e.g., `:root { --pretable-row-height: 18px; }`).
- **Affect Grid Alpha / GridGamma / GridBeta adapters** — those use their own theming systems. Pretable's @pretable/ui only affects the pretable adapter.
- **Add visual regression tests** — deferred per spec section "Testing." Manual review confirms the visual delta.

---

## After this PR lands

The 5-PR theming arc is complete. `@pretable/ui` is in production use:

- `apps/website` — playground grid uses Material 3 dark theme (PR 4, demo of Material's prebuilt look)
- `apps/bench` — pretable adapter grid uses Excel theme (PR 5, demo of dense/technical look)

External consumers can now adopt `@pretable/ui` per the README's recipes: drop-in Excel default, Material with light/dark switching, runtime density picker, Tailwind v4 bridge, etc. The package remains pre-1.0 experimental — token names may rename in patch releases, override at consumer's risk.
