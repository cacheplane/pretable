# Grid Token Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 11 grid-control colors `grid.css` depends on out of the undocumented `--pt-color-*` namespace into the documented `--pretable-*` theme contract (theme-derived), so the documented `theme.css + grid.css` recipe yields a fully-themed grid.

**Architecture:** Define 10 new `--pretable-*` grid-control tokens in each theme (derived from that theme's existing tokens), repoint `grid.css` to them (deduping `--pt-color-focus-ring` onto the existing `--pretable-focus-ring`), delete the dead `--pt-color-*` from `tokens.css`, and extend `contract.test.ts` so the contract stays complete. Pre-1.0, no backcompat.

**Tech Stack:** CSS custom properties + `color-mix`, vitest (jsdom) for `@pretable/ui`, Next.js MDX docs.

**Spec:** `docs/superpowers/specs/2026-06-07-grid-token-consolidation-design.md`

**The 10 new tokens** (each defined in both themes, derived):

```css
--pretable-selection-bg: color-mix(
  in srgb,
  var(--pretable-accent) 8%,
  transparent
);
--pretable-checkbox-bg: var(--pretable-bg-grid);
--pretable-checkbox-border: var(--pretable-rule-strong);
--pretable-checkbox-checked-bg: var(--pretable-accent);
--pretable-checkbox-checked-fg: #fff;
--pretable-resize-handle: transparent;
--pretable-resize-handle-hover: var(--pretable-accent);
--pretable-reorder-ghost-bg: var(--pretable-bg-header);
--pretable-reorder-ghost-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
--pretable-reorder-drop-indicator: var(--pretable-accent);
```

(`--pt-color-focus-ring` is NOT replaced by a new token — it dedupes onto the existing `--pretable-focus-ring`.)

---

### Task 1: Define the grid-control tokens in both themes (test-first via contract.test.ts)

**Files:**

- Modify: `packages/ui/src/__tests__/contract.test.ts` (the `TOKENS` array, ~lines 5-30)
- Modify: `packages/ui/src/themes/material.css` (`:root` block)
- Modify: `packages/ui/src/themes/excel.css` (`:root` block)

- [ ] **Step 1: Extend the `TOKENS` list (makes the existing contract test fail)**

In `packages/ui/src/__tests__/contract.test.ts`, the `TOKENS` array lists the 24 existing token names (without the `--` prefix), e.g. `"pretable-bg-grid"`. Append these 10:

```ts
  "pretable-selection-bg",
  "pretable-checkbox-bg",
  "pretable-checkbox-border",
  "pretable-checkbox-checked-bg",
  "pretable-checkbox-checked-fg",
  "pretable-resize-handle",
  "pretable-resize-handle-hover",
  "pretable-reorder-ghost-bg",
  "pretable-reorder-ghost-shadow",
  "pretable-reorder-drop-indicator",
```

(Add them inside the `const TOKENS = [ … ]` array, before the closing `];`.)

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `pnpm --filter @pretable/ui exec vitest run src/__tests__/contract.test.ts`
Expected: FAIL — `excel.css: --pretable-selection-bg is empty` (and the other 9) for both themes, because the themes don't define them yet.

- [ ] **Step 3: Add the 10 derived tokens to each theme's `:root`**

In `packages/ui/src/themes/material.css`, inside the `:root { … }` block (e.g. right after the `/* Accent */` group), add:

```css
/* Grid controls — derived from this theme's tokens so they recolor coherently */
--pretable-selection-bg: color-mix(
  in srgb,
  var(--pretable-accent) 8%,
  transparent
);
--pretable-checkbox-bg: var(--pretable-bg-grid);
--pretable-checkbox-border: var(--pretable-rule-strong);
--pretable-checkbox-checked-bg: var(--pretable-accent);
--pretable-checkbox-checked-fg: #fff;
--pretable-resize-handle: transparent;
--pretable-resize-handle-hover: var(--pretable-accent);
--pretable-reorder-ghost-bg: var(--pretable-bg-header);
--pretable-reorder-ghost-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
--pretable-reorder-drop-indicator: var(--pretable-accent);
```

Add the **identical block** to `packages/ui/src/themes/excel.css`'s `:root { … }` block. Do NOT add them to Material's `[data-theme="dark"]` block — they derive from tokens the dark block already overrides, so they adapt automatically.

- [ ] **Step 4: Run the contract test + full ui suite to verify pass**

Run: `pnpm --filter @pretable/ui exec vitest run`
Expected: PASS — `contract.test.ts` now confirms both themes define all 34 tokens (incl. dark mode + density tiers for the pre-existing ones); `density.test.ts`/`css-cascade.test.ts`/`build-config.test.ts` unaffected.

Run: `pnpm exec prettier --write packages/ui/src/themes/material.css packages/ui/src/themes/excel.css packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/themes/material.css packages/ui/src/themes/excel.css packages/ui/src/__tests__/contract.test.ts
git commit -m "feat(ui): add grid-control tokens to the --pretable-* theme contract

Defines 10 grid-control tokens (checkbox/selection/resize/reorder) in both themes,
derived from each theme's accent/bg/rule so they recolor coherently and adapt to
dark mode. Extends contract.test.ts so every theme must define them."
```

---

### Task 2: Repoint grid.css to the new tokens + guard the consolidation

**Files:**

- Modify: `packages/ui/src/grid.css` (the 16 `var(--pt-color-*)` references)
- Modify: `packages/ui/src/__tests__/contract.test.ts` (var-resolution test → both themes; new no-`--pt-color-` assertion)

- [ ] **Step 1: Strengthen the tests first (they should fail against the current grid.css)**

In `packages/ui/src/__tests__/contract.test.ts`:

(a) Add a structural assertion that `grid.css` no longer references the old namespace. Add this test inside the `describe("token contract", …)` block:

```ts
test("grid.css references no --pt-color-* tokens (consolidated into --pretable-*)", () => {
  const gridCss = fs.readFileSync(GRID_CSS, "utf8");
  const stale = [...gridCss.matchAll(/var\((--pt-color-[a-z-]+)/g)].map(
    (m) => m[1],
  );
  expect(stale, `grid.css still references ${stale.join(", ")}`).toEqual([]);
});
```

(b) The existing test "grid.css has no unresolved var(--pretable-\*) references when excel.css is loaded" loads only `excel.css`. Generalize it to BOTH themes. Replace that single test with a loop:

```ts
for (const themeFile of ["excel.css", "material.css"]) {
  test(`grid.css has no unresolved var(--pretable-*) refs under ${themeFile}`, () => {
    const themeCleanup = loadCSS(path.join(THEMES_DIR, themeFile));
    const gridCss = fs.readFileSync(GRID_CSS, "utf8");
    const refs = new Set(
      Array.from(gridCss.matchAll(/var\((--pretable-[a-z-]+)/g)).map(
        (m) => m[1],
      ),
    );
    expect(
      refs.size,
      "grid.css references zero --pretable-* vars; this is suspicious",
    ).toBeGreaterThan(0);
    const computed = getComputedStyle(document.documentElement);
    for (const ref of refs) {
      expect(
        computed.getPropertyValue(ref).trim(),
        `grid.css references unresolved ${ref} under ${themeFile}`,
      ).not.toBe("");
    }
    themeCleanup();
  });
}
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm --filter @pretable/ui exec vitest run src/__tests__/contract.test.ts`
Expected: FAIL — the no-`--pt-color-` test reports grid.css still references `--pt-color-checkbox-bg` etc.; and the `--pretable-*` resolution test fails on `--pretable-selection-bg`/etc. being unresolved (grid.css still uses the old names, which aren't `--pretable-*`). (The new `--pretable-*` grid tokens ARE defined by the themes from Task 1, so once grid.css is repointed they resolve.)

- [ ] **Step 3: Repoint grid.css (single rename — the new names mirror the old suffixes)**

The 10 new tokens are `--pretable-<suffix>` mirroring `--pt-color-<suffix>`, and `--pt-color-focus-ring` maps to the existing `--pretable-focus-ring`, so one substitution does it all:

```bash
sed -i '' 's/--pt-color-/--pretable-/g' packages/ui/src/grid.css
```

(`sed -i ''` is macOS/BSD; on Linux use `sed -i`.) Verify: `grep -n 'pt-color' packages/ui/src/grid.css` → nothing. Skim the diff — every change should be a `var(--pt-color-X)` → `var(--pretable-X)` inside the existing `@layer pretable { :where(…) }` rules; nothing else.

- [ ] **Step 4: Run the ui suite to verify pass**

Run: `pnpm --filter @pretable/ui exec vitest run`
Expected: PASS — both new/generalized tests pass (grid.css has no `--pt-color-`; all its `--pretable-*` refs resolve under excel AND material), and the existing suite stays green.

Run: `pnpm exec prettier --write packages/ui/src/grid.css packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/contract.test.ts
git commit -m "feat(ui): repoint grid.css to the --pretable-* grid-control tokens

Renames the 16 var(--pt-color-*) refs to --pretable-* (focus-ring dedupes onto
the existing --pretable-focus-ring). Adds a guard that grid.css references no
--pt-color-*, and verifies grid.css's --pretable-* deps resolve under BOTH themes
(was excel-only) — proving the documented recipe yields a fully-themed grid."
```

---

### Task 3: Delete the dead grid-control tokens from tokens.css

**Files:**

- Modify: `packages/ui/src/tokens.css` (remove the grid-control `--pt-color-*` declarations)

- [ ] **Step 1: Confirm no remaining consumers**

Run: `grep -rn 'pt-color-\(selection\|focus-ring\|resize\|reorder\|checkbox\)' packages apps --include='*.css' --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v dist`
Expected: only `packages/ui/src/tokens.css` (the declarations themselves). If `grid.css` appears, Task 2 was not completed — stop. (The only other `--pt-color-*` consumer is `heroGrid.module.css` via `--pt-color-warning`, which this grep does not match and must stay.)

- [ ] **Step 2: Remove the dead declarations**

In `packages/ui/src/tokens.css`, delete these four comment groups and their declarations entirely:

```css
/* Cell-range selection (Phase 3 — derived from accent) */
--pt-color-selection-bg: rgb(234 88 12 / 0.08);
--pt-color-selection-border: rgb(234 88 12 / 0.6);
--pt-color-focus-ring: var(--pt-accent);

/* Column resize handle (sub-project C) */
--pt-color-resize-handle: transparent;
--pt-color-resize-handle-hover: var(--pt-color-selection-border);

/* Column reorder ghost + drop indicator (sub-project C) */
--pt-color-reorder-ghost-bg: var(--pt-color-surface, #fff);
--pt-color-reorder-ghost-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
--pt-color-reorder-drop-indicator: var(--pt-color-focus-ring);

/* Row-selection checkbox column (Phase 4) */
--pt-color-checkbox-bg: #fff;
--pt-color-checkbox-border: #d1d5db;
--pt-color-checkbox-checked-bg: var(--pt-accent);
--pt-color-checkbox-checked-fg: #fff;
```

Leave everything else in `tokens.css` untouched (Alpenglow palette, type scale, layout tokens, and any `--pt-color-*` NOT in the list above, e.g. `--pt-color-warning` if present).

- [ ] **Step 3: Verify**

Run: `grep -nE 'pt-color-(selection|focus-ring|resize|reorder|checkbox)' packages/ui/src/tokens.css` → nothing.
Run: `pnpm --filter @pretable/ui exec vitest run`
Expected: PASS (the grid-control tokens now come from the themes; tokens.css no longer needs them).

Run: `pnpm exec prettier --write packages/ui/src/tokens.css`

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/tokens.css
git commit -m "chore(ui): drop dead grid-control tokens from tokens.css

The grid-control --pt-color-* (checkbox/selection/resize/reorder/focus-ring) now
live in the --pretable-* theme contract; remove their now-unreferenced
declarations from the Alpenglow palette file. Non-grid --pt-color-* (e.g. warning)
are untouched."
```

---

### Task 4: Document the grid-control tokens

**Files:**

- Modify: `apps/website/content/docs/theming/token-reference.mdx`

- [ ] **Step 1: Add the grid-control tokens to the reference table**

`apps/website/content/docs/theming/token-reference.mdx` documents the token contract in a table (the "Full 24-token table"). Read it first to match its column structure (likely: token | description | example value), then add a "Grid controls" group of 10 rows for the new tokens. Use these descriptions:

| Token                               | Description                                                  |
| ----------------------------------- | ------------------------------------------------------------ |
| `--pretable-selection-bg`           | Range-selection overlay background (`[aria-selected]` cells) |
| `--pretable-checkbox-bg`            | Row-select checkbox background                               |
| `--pretable-checkbox-border`        | Row-select checkbox border                                   |
| `--pretable-checkbox-checked-bg`    | Row-select checkbox background when checked                  |
| `--pretable-checkbox-checked-fg`    | Row-select checkmark color                                   |
| `--pretable-resize-handle`          | Column resize handle (idle)                                  |
| `--pretable-resize-handle-hover`    | Column resize handle (hover/dragging)                        |
| `--pretable-reorder-ghost-bg`       | Column drag ghost background                                 |
| `--pretable-reorder-ghost-shadow`   | Column drag ghost shadow                                     |
| `--pretable-reorder-drop-indicator` | Column drop-position indicator                               |

Note in the prose that these derive from the theme's `--pretable-accent`/`-bg-grid`/`-rule-strong` by default, so overriding those recolors the controls coherently. If the doc states a token count ("24 tokens"), update it to 34.

- [ ] **Step 2: Format + run website docs-validation tests**

Run: `pnpm exec prettier --write apps/website/content/docs/theming/token-reference.mdx`
Run: `pnpm --filter @pretable/app-website exec vitest run lib/docs app/llms.txt`
Expected: PASS (21 tests). If it errors on `@pretable/core` resolution, run `pnpm install --frozen-lockfile` first (stale local link), then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/website/content/docs/theming/token-reference.mdx
git commit -m "docs(theming): document the 10 grid-control tokens in the token reference"
```

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @pretable/ui exec vitest run` → pass (contract 34 tokens both themes, both-theme grid.css resolution, no-`--pt-color-` guard, css-cascade, density, build-config).
- [ ] `grep -rnE 'var\(--pt-color-(selection|focus-ring|resize|reorder|checkbox)' packages apps --include='*.css' | grep -v node_modules | grep -v dist` → nothing (no grid-control `--pt-color-*` consumed anywhere).
- [ ] `pnpm --filter @pretable/app-website exec vitest run lib/docs app/llms.txt` → 21 pass.
- [ ] Optional visual sanity: `pnpm bench:matrix --adapters=pretable --scenarios=S2 --scripts=initial --scale=dev --repeats=1` completes (the bench grid now resolves its control colors from excel.css; previously undefined).
- [ ] Open a PR; let CI (test/typecheck/lint/format/build/packaging/api-report) gate the merge.

## Out of scope (do NOT implement here)

Brand-primitive derivation layer; dark mode for Excel; Tailwind bridge aliases for the grid-control tokens.
