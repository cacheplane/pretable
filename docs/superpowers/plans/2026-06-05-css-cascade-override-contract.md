# CSS Cascade & Override Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@pretable/ui`'s grid CSS reliably overridable by consumers — wrap `grid.css` in `@layer pretable` and flatten every selector with `:where()` so token and deep-CSS overrides both win without specificity tricks.

**Architecture:** `grid.css` becomes a single `@layer pretable` block with every selector `:where()`-flattened to specificity (0,0,0). Token files stay unlayered (jsdom can't resolve layered custom props; token overrides already win by source order). Apps declare `@layer theme, base, pretable, components, utilities;` so the grid sits after Tailwind Preflight but before utilities. Two guards: a structural unit test (CI-cheap) and one real-browser Playwright cascade test.

**Tech Stack:** CSS cascade layers + `:where()`, vitest (jsdom) for `@pretable/ui`, Playwright (Chromium) under the root config, Next.js MDX docs.

**Spec:** `docs/superpowers/specs/2026-06-05-css-cascade-override-contract-design.md`

---

### Task 1: Migrate `grid.css` to `@layer pretable` + `:where()`, guarded by a structural test

**Files:**

- Create: `packages/ui/src/__tests__/css-cascade.test.ts`
- Modify: `packages/ui/src/grid.css` (full rewrite below)

- [ ] **Step 1: Write the failing structural test**

Create `packages/ui/src/__tests__/css-cascade.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GRID_CSS = path.resolve(__dirname, "../grid.css");

describe("grid.css cascade contract", () => {
  test("grid.css declares @layer pretable", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/@layer\s+pretable\s*\{/);
  });

  test("every grid.css rule selector is wrapped in :where()", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...noComments.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) {
      if (/^@layer\s+pretable$/.test(sel)) continue; // the layer block opener
      expect(sel, `selector not wrapped in :where(): "${sel}"`).toMatch(
        /^:where\(/,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/ui exec vitest run src/__tests__/css-cascade.test.ts`
Expected: FAIL — first test fails (`@layer pretable` absent), second fails (selectors like `[data-pretable-scroll-viewport]` don't start with `:where(`).

- [ ] **Step 3: Rewrite `packages/ui/src/grid.css`**

Replace the ENTIRE file with this (header comment updated; whole body wrapped in `@layer pretable`; every selector wrapped in `:where()`; source order unchanged — see spec §3, no reordering needed):

```css
/**
 * @pretable/ui/grid.css
 * Selector-based grid skin. Targets data attributes exposed by @pretable/react;
 * values reference --pretable-* tokens defined by theme files.
 *
 * All rules live in the `pretable` cascade layer and use :where() so every
 * default is specificity (0,0,0). Consumers override by writing any selector
 * (it wins on specificity) or any unlayered / later-layer rule (it wins on
 * layer order). Recommended layer order in your app:
 *   @layer theme, base, pretable, components, utilities;
 *
 * Consumer recipe:
 *   @import "@pretable/ui/themes/excel.css";
 *   @import "@pretable/ui/grid.css";
 */

@layer pretable {
  /* Visually hidden — used for ARIA live region announcements. */
  :where(.pt-sr-only) {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Outer viewport (scrollable container) */
  :where([data-pretable-scroll-viewport]) {
    background: var(--pretable-bg-grid);
    border: 1px solid var(--pretable-rule-strong);
    border-radius: var(--pretable-radius);
    font-family: var(--pretable-font-sans);
    color: var(--pretable-text-cell);
  }

  /* Header row */
  :where([data-pretable-header-row]) {
    background: var(--pretable-bg-header);
    border-bottom: 1px solid var(--pretable-rule-strong);
    height: var(--pretable-header-height);
  }

  :where([data-pretable-header-cell]) {
    display: flex;
    align-items: center;
    padding: 0 var(--pretable-cell-padding-x);
    font-size: var(--pretable-font-size-header);
    font-weight: 500;
    color: var(--pretable-text-header);
    border-right: 1px solid var(--pretable-rule);
    box-sizing: border-box;
  }

  :where([data-pretable-header-cell]:last-of-type) {
    border-right: none;
  }

  /* Body cells */
  :where([data-pretable-cell]) {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    padding: var(--pretable-cell-padding-y) var(--pretable-cell-padding-x);
    font-size: var(--pretable-font-size-cell);
    color: var(--pretable-text-cell);
    background: var(--pretable-bg-grid);
    border-right: 1px solid var(--pretable-rule);
    border-bottom: 1px solid var(--pretable-rule);
  }

  :where([data-pretable-cell]:last-of-type) {
    border-right: none;
  }

  /* Zebra striping — only effective when --pretable-bg-grid-alt differs */
  :where([data-pretable-row]:nth-child(even) [data-pretable-cell]) {
    background: var(--pretable-bg-grid-alt);
  }

  /* Hover */
  :where([data-pretable-row]:hover [data-pretable-cell]) {
    background: var(--pretable-bg-hover);
  }

  /* Pinned cells (sticky left/right) — reuse header background */
  :where(
    [data-pretable-cell][data-pinned="left"],
    [data-pretable-cell][data-pinned="right"]
  ) {
    background: var(--pretable-bg-header);
    z-index: 1;
  }

  /* Selection — wins over zebra/hover via source order (they precede it) */
  :where([data-pretable-cell][data-selected="true"]) {
    background: var(--pretable-bg-selected);
    color: var(--pretable-text-selected);
  }

  /* Focus */
  :where([data-pretable-cell][data-focused="true"]) {
    outline: 2px solid var(--pretable-focus-ring);
    outline-offset: -2px;
  }

  /**
   * Theme-agnostic cell-range selection visuals (Phase 3).
   * Targets the ARIA role + aria-selected attribute exposed by @pretable/react,
   * so consumers using only @pretable/ui's tokens.css (no theme file) still get
   * a usable visual.
   */
  :where([role="gridcell"][aria-selected="true"]) {
    background: var(--pt-color-selection-bg);
  }

  :where([role="gridcell"][data-focused="true"]) {
    box-shadow: inset 0 0 0 2px var(--pt-color-focus-ring);
  }

  /* Numeric cells (opt-in via [data-pretable-numeric="true"]) */
  :where([data-pretable-cell][data-pretable-numeric="true"]) {
    font-family: var(--pretable-font-mono);
    text-align: right;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
  }

  /* Toolbar / status bar — applied if engine wraps in named data attribute */
  :where([data-pretable-toolbar], [data-pretable-status-bar]) {
    background: var(--pretable-bg-toolbar);
    color: var(--pretable-text-dim);
    font-family: var(--pretable-font-sans);
    font-size: var(--pretable-font-size-cell);
  }

  /* Row-selection checkbox column (Phase 4) */
  :where(
    [data-pretable-cell][data-row-select-cell="true"],
    [data-pretable-header-cell][data-pretable-row-select-header]
  ) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  :where(
    button[data-pretable-row-select],
    button[data-pretable-row-select-all]
  ) {
    width: 16px;
    height: 16px;
    border: 1px solid var(--pt-color-checkbox-border);
    background: var(--pt-color-checkbox-bg);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    color: var(--pt-color-checkbox-checked-fg);
  }
  :where(
    button[data-pretable-row-select][aria-checked="true"],
    button[data-pretable-row-select-all][aria-checked="true"]
  ) {
    background: var(--pt-color-checkbox-checked-bg);
    border-color: var(--pt-color-checkbox-checked-bg);
    color: var(--pt-color-checkbox-checked-fg);
  }
  :where(
    button[data-pretable-row-select][aria-checked="mixed"],
    button[data-pretable-row-select-all][aria-checked="mixed"]
  ) {
    background: var(--pt-color-checkbox-checked-bg);
    border-color: var(--pt-color-checkbox-checked-bg);
    color: var(--pt-color-checkbox-checked-fg);
  }

  /* Column resize handle (sub-project C) */
  :where([data-pretable-resize-handle]) {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    background: var(--pt-color-resize-handle);
    z-index: 2;
    user-select: none;
    touch-action: none;
  }
  :where(
    [data-pretable-resize-handle]:hover,
    [data-pretable-resize-handle][data-dragging="true"]
  ) {
    background: var(--pt-color-resize-handle-hover);
  }

  /* Column reorder gesture (sub-project C) */
  :where([data-pretable-reorder-ghost]) {
    position: fixed;
    pointer-events: none;
    background: var(--pt-color-reorder-ghost-bg);
    box-shadow: var(--pt-color-reorder-ghost-shadow);
    opacity: 0.6;
    z-index: 10;
    user-select: none;
  }
  :where([data-pretable-reorder-drop-indicator]) {
    position: absolute;
    top: 0;
    width: 2px;
    background: var(--pt-color-reorder-drop-indicator);
    z-index: 9;
    pointer-events: none;
  }

  /* Tooltip / popover */
  :where([data-pretable-popover]) {
    background: var(--pretable-bg-tooltip);
    color: var(--pretable-text-cell);
    border: 1px solid var(--pretable-rule);
    border-radius: var(--pretable-radius);
  }
}
```

- [ ] **Step 4: Run the new test + the existing `@pretable/ui` suite + format**

Run: `pnpm --filter @pretable/ui exec vitest run`
Expected: PASS — the two new cascade tests pass, AND the existing `contract.test.ts` / `density.test.ts` / `build-config.test.ts` still pass (token files are unlayered, so jsdom still resolves them).

Run: `pnpm exec prettier --write packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts`
Expected: both files formatted (the `:where(...)` multi-line groups may reflow — that's fine).

Run: `pnpm --filter @pretable/ui exec vitest run src/__tests__/css-cascade.test.ts`
Expected: PASS (re-confirm after prettier reflow).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "feat(ui): wrap grid.css in @layer pretable with :where()-flattened selectors

Makes every grid default specificity (0,0,0) inside the pretable cascade layer,
so consumer overrides (tokens, deep CSS, or unlayered/later-layer rules) win
without !important or specificity tricks. Token files stay unlayered. Source
order already yields correct state precedence; the only behavior delta is
selected/focused now winning over zebra/hover (previously a specificity
artifact). Guarded by a structural test."
```

---

### Task 2: Declare the cascade layer order in the apps

**Files:**

- Modify: `apps/website/app/globals.css` (top of file)
- Modify: `apps/bench/src/app.css` (top of file)

- [ ] **Step 1: Add the layer-order line to the website**

Open `apps/website/app/globals.css`. Immediately AFTER any leading `@charset`/license comment but BEFORE the first `@import`, add:

```css
/* Declare cascade order: pretable sits after Tailwind's base (Preflight can't
   clobber the grid) and before utilities (utility classes still win). */
@layer theme, base, pretable, components, utilities;
```

(The `@layer` statement must appear before the rules it orders; placing it at the very top is safe and explicit. Keep all existing `@import`/`@theme` lines unchanged.)

- [ ] **Step 2: Add the same line to the bench app**

Open `apps/bench/src/app.css` and add the identical block at the very top (before its first `@import`):

```css
/* Declare cascade order: pretable sits after Tailwind's base (Preflight can't
   clobber the grid) and before utilities (utility classes still win). */
@layer theme, base, pretable, components, utilities;
```

- [ ] **Step 3: Verify both apps still typecheck/build-config and format**

Run: `pnpm exec prettier --write apps/website/app/globals.css apps/bench/src/app.css`
Expected: formatted, no errors.

Run: `pnpm --filter @pretable/app-website exec vitest run lib/docs`
Expected: PASS (sanity that website tooling is unaffected; CSS isn't typechecked but this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/globals.css apps/bench/src/app.css
git commit -m "chore(apps): declare @layer order so the grid layer beats Preflight

Adds '@layer theme, base, pretable, components, utilities;' to the website and
bench global CSS. Doubles as the reference example for external Tailwind
consumers."
```

---

### Task 3: Real-browser Playwright test proving consumer overrides win

**Files:**

- Create: `apps/bench/tests/cascade-override.spec.ts`

This test is self-contained: it builds a tiny DOM with `page.setContent`, loads the real `excel.css` (unlayered tokens) and the migrated `grid.css` (layered), then proves both that a consumer's unlayered rule beats the layered default and that the selected-over-hover precedence delta holds. It reads CSS straight from `packages/ui/src` (no build/server needed); the root Playwright `webServer` will still start but the test ignores it.

- [ ] **Step 1: Write the test**

Create `apps/bench/tests/cascade-override.spec.ts`:

```ts
import path from "node:path";
import { expect, test } from "@playwright/test";

const UI_SRC = path.resolve(__dirname, "../../../packages/ui/src");
const EXCEL_CSS = path.join(UI_SRC, "themes/excel.css");
const GRID_CSS = path.join(UI_SRC, "grid.css");

test("an unlayered consumer rule beats the layered grid default", async ({
  page,
}) => {
  await page.setContent(
    '<div data-pretable-scroll-viewport><span data-pretable-cell id="c">x</span></div>',
  );
  await page.addStyleTag({ path: EXCEL_CSS }); // unlayered tokens
  await page.addStyleTag({ path: GRID_CSS }); // layered grid rules (:where)

  const cell = page.locator("#c");
  // Sanity: the layered default applied a non-empty color from the theme.
  const defaultColor = await cell.evaluate((el) => getComputedStyle(el).color);
  expect(defaultColor).not.toBe("");

  // A bare unlayered consumer rule (specificity (0,1,0)) must win over the
  // layered, :where()-flattened (0,0,0) default purely via layer order.
  await page.addStyleTag({
    content: "[data-pretable-cell] { color: rgb(7, 8, 9); }",
  });
  await expect(cell).toHaveCSS("color", "rgb(7, 8, 9)");
});

test("selected background wins over zebra via source order", async ({
  page,
}) => {
  // Pin the relevant tokens to known rgb values inline, so the assertion is
  // format-deterministic. The selected cell sits in an EVEN row, so the zebra
  // rule also targets it — proving selected wins is the behavior we locked.
  await page.setContent(
    "<div data-pretable-scroll-viewport " +
      'style="--pretable-bg-grid-alt: rgb(50, 50, 50); --pretable-bg-selected: rgb(1, 2, 3)">' +
      "<div data-pretable-row></div>" + // row 1 (odd)
      "<div data-pretable-row>" + // row 2 (even → zebra applies)
      '<span data-pretable-cell data-selected="true" id="sel">x</span>' +
      "</div></div>",
  );
  await page.addStyleTag({ path: GRID_CSS });

  // Both zebra (rgb 50,50,50) and selected (rgb 1,2,3) match #sel; selected
  // must win because its rule comes later in source order at equal (0,0,0).
  await expect(page.locator("#sel")).toHaveCSS(
    "background-color",
    "rgb(1, 2, 3)",
  );
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec playwright test apps/bench/tests/cascade-override.spec.ts`
Expected: PASS — the first test asserts the consumer color wins (`rgb(7, 8, 9)`); the second confirms the selected background resolves to a non-empty value.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/tests/cascade-override.spec.ts
git commit -m "test(bench): real-browser proof that consumer CSS overrides the grid layer

Loads excel.css + the migrated grid.css in Chromium and asserts an unlayered
consumer rule beats the layered :where() default, and that the selected
background survives the zebra/hover rules."
```

---

### Task 4: Document the cascade & override contract

**Files:**

- Create: `apps/website/content/docs/theming/cascade-and-overrides.mdx`
- Modify: `apps/website/content/docs/theming/index.mdx` (architecture note)
- Modify: `apps/website/content/docs/theming/tailwind-css-in-js.mdx` (layer-order line)
- Modify: `apps/website/content/docs/theming/override-tokens.mdx` (specificity note)
- Modify: `packages/ui/README.md` (CSS-contract section)

- [ ] **Step 1: Write the new docs page**

Create `apps/website/content/docs/theming/cascade-and-overrides.mdx`:

````mdx
---
title: Cascade & overrides
description: "How Pretable's CSS layers work and how to override any part with plain CSS."
nav: Theming
order: 8
---

All of Pretable's grid styling lives in a single cascade layer named `pretable`, and every default selector is wrapped in `:where()` so it carries **zero specificity**. Together these mean your styles win — by layer order, by specificity, or both — without `!important` or specificity tricks.

## Three ways to override, in increasing power

1. **Tokens** — set any `--pretable-*` variable at `:root` or a scoped selector. This is the blessed path for recoloring and resizing. Override _after_ importing the theme file. See [Override tokens](/docs/theming/override-tokens).
2. **Deep CSS** — write a selector targeting any grid part. Because the defaults are specificity `(0,0,0)`, even a single class wins:

   ```css
   .my-grid [data-pretable-cell][data-selected="true"] {
     background: hotpink;
   }
   ```
````

3. **Layer order** — because all Pretable CSS is in `@layer pretable`, anything **unlayered** or in a **later layer** wins regardless of specificity.

## Declare the layer order (Tailwind / reset users)

If you use cascade layers — including Tailwind v4, which layers Preflight in `base` — declare the order once so the cascade is predictable:

```css
@layer theme, base, pretable, components, utilities;
```

- `pretable` is **after `base`**, so a reset (Tailwind Preflight, `normalize.css` in `base`) cannot clobber the grid's borders and padding.
- `pretable` is **before `utilities`**, so a utility class like `class="bg-red-500"` on a cell still wins.

If you don't use layers at all, you need none of this — plain unlayered CSS beats every layer automatically.

> Put resets in `@layer base`. A `normalize.css` imported **unlayered** would beat the grid (unlayered beats all layers) and could strip its styling.

## Worked examples

**Recolor the selected cell**

```css
[data-pretable-cell][data-selected="true"] {
  background: #1d4ed8;
  color: white;
}
```

**Restyle the header**

```css
[data-pretable-header-cell] {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 700;
}
```

**Thicker resize handle**

```css
[data-pretable-resize-handle] {
  width: 8px;
}
```

Each of these is a plain selector with no `!important` — they win because the grid's defaults are layered and specificity-`(0,0,0)`.

````

- [ ] **Step 2: Add an architecture note to `index.mdx`**

Open `apps/website/content/docs/theming/index.mdx`. Find the section describing the layered architecture (the "three-layer" overview) and add, as a new paragraph at the end of that section:

```mdx
All grid selectors ship inside a single `@layer pretable` cascade layer and are wrapped in `:where()` (zero specificity), so your overrides win without specificity tricks. See [Cascade & overrides](/docs/theming/cascade-and-overrides) for the full contract and the layer-order line for Tailwind/reset users.
````

- [ ] **Step 3: Add the layer-order line to `tailwind-css-in-js.mdx`**

Open `apps/website/content/docs/theming/tailwind-css-in-js.mdx`. After the existing `@import "tailwindcss";` / `@theme inline` guidance, add a new section:

````mdx
## Cascade layer order

Tailwind v4 layers its Preflight reset in `base`. Declare the order once so the grid layer sits after the reset but before your utilities:

```css
@layer theme, base, pretable, components, utilities;
```
````

This keeps Preflight from clobbering the grid while letting your utility classes win on individual cells. See [Cascade & overrides](/docs/theming/cascade-and-overrides).

````

- [ ] **Step 3b: Add a specificity note to `override-tokens.mdx`**

Open `apps/website/content/docs/theming/override-tokens.mdx`. At the end of its intro section (before the first worked example), add:

```mdx
> Token overrides are the simplest path, but you can also override any rendered style with plain CSS — the grid's defaults are zero-specificity and layered, so your selectors win without `!important`. See [Cascade & overrides](/docs/theming/cascade-and-overrides).
````

- [ ] **Step 4: Update the `@pretable/ui` README CSS-contract section**

Open `packages/ui/README.md`. Find the section that documents the CSS contract / import recipe. Add this paragraph to it:

````md
### Cascade layer

`grid.css` ships inside a single `@layer pretable` cascade layer, and every
selector is wrapped in `:where()` (specificity `(0,0,0)`). Consumer CSS wins by
layer order or specificity without `!important`. In a Tailwind v4 app declare:

```css
@layer theme, base, pretable, components, utilities;
```
````

Token files (`tokens.css`, `themes/*.css`) are intentionally **unlayered** —
override tokens after importing the theme. See the website's "Cascade &
overrides" theming page for the full contract.

````

- [ ] **Step 5: Format and run the website docs-validation tests**

Run: `pnpm exec prettier --write "apps/website/content/docs/theming/*.mdx" packages/ui/README.md`
Expected: formatted.

Run: `pnpm --filter @pretable/app-website exec vitest run lib/docs app/llms.txt`
Expected: PASS — the docs loader/enumerate/search-index tests pick up the new page and still pass (this is how the existing clipboard-docs PR was validated).

- [ ] **Step 6: Commit**

```bash
git add apps/website/content/docs/theming/cascade-and-overrides.mdx apps/website/content/docs/theming/index.mdx apps/website/content/docs/theming/tailwind-css-in-js.mdx apps/website/content/docs/theming/override-tokens.mdx packages/ui/README.md
git commit -m "docs(theming): document the @layer pretable + :where() override contract

New 'Cascade & overrides' page plus the layer-order line in the architecture
overview, Tailwind page, and @pretable/ui README."
````

---

## Final verification (after all tasks)

- [ ] Run `pnpm --filter @pretable/ui exec vitest run` → all pass (cascade + contract + density + build-config).
- [ ] Run `pnpm exec playwright test apps/bench/tests/cascade-override.spec.ts` → pass.
- [ ] Run `pnpm --filter @pretable/app-website exec vitest run lib/docs app/llms.txt` → pass.
- [ ] Run `pnpm exec prettier --check packages/ui/src/grid.css apps/website/content/docs/theming/cascade-and-overrides.mdx` → clean.
- [ ] Open a PR; let CI (test/typecheck/lint/build/format) gate the merge.

## Out of scope (do NOT implement here)

Semantic targeting attributes (`data-column-id`, `data-cell-type`); brand/semantic token-alias layer; dark mode for Excel; unstyled/headless variant. Each is tracked separately.
