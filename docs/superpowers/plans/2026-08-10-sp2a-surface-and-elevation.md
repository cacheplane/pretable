# SP2a: Surface & Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the grid a real surface and elevation vocabulary — pinned cells and group rows stop borrowing the header's fill, small controls stop borrowing the card's radius, and overlays stop borrowing a token named after a drag ghost — and fix two bugs that vocabulary exposes.

**Architecture:** Every new token defaults to the value the shipped themes already resolve to, so **Excel and Material are appearance-neutral except where a genuine bug is fixed**. The visible payoff arrives in SP3, when `pretable.css` sets them differently. Two bugs are fixed here because they are only expressible once the tokens exist: row hover never reaches pinned cells, and Material's dark mode never overrides the one shadow.

**Tech Stack:** vanilla CSS in `@pretable/ui` (no Tailwind, no CSS-in-JS), vitest + jsdom for the contract and cascade guards, Playwright for real-browser cascade behaviour.

---

## Constraints that bite

- Every selector in `grid.css` lives in `@layer pretable` and **must be wrapped in `:where()`** — `css-cascade.test.ts` enumerates every selector and fails any that isn't.
- Every selector is therefore specificity `(0,0,0)`, so **source order is the only cascade lever**. Several rules in this plan depend on it; each says so.
- `contract.test.ts` requires every `var(--pretable-*)` referenced in `grid.css` to resolve non-empty at `:root` under **both** themes. A new token used in CSS but missing from a theme fails there.
- The token list in `contract.test.ts` is a presence list, currently **39** entries. It is one-directional: nothing catches a theme-defined token no stylesheet reads.
- Prettier reformats long CSS selector lists across lines. Write regex assertions whitespace-tolerantly (`\s*`), and run `npx prettier --write` **before** trusting a test.

## Deliberately NOT doing

- **The `background-image` "wash" for hover/selection.** The spec proposed it so state composes over surface. Dropped: the surface rules all use the `background` shorthand, which resets `background-image: none`, so it would need five more rewrites to work at all — and its one unique benefit, zebra composing with pinned, is unreachable either way because zebra and pinned are both surface fills competing for one slot. Reordering surface-then-state (Task 2) achieves the visible outcome with none of that risk.
- **Changing Excel's or Material's appearance.** They are compatibility skins. Every new token defaults to today's resolved value.
- **The container edge value change.** `--pretable-shadow-card` is introduced here and set to `none` in both shipped themes; `pretable.css` uses it in SP3.

## File structure

| File                                            | Change                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/ui/src/grid.css`                      | Retarget 5 fills, reorder hover, add radius-control + card/seam shadows |
| `packages/ui/src/themes/excel.css`              | Add 5 tokens at today's values; `shadow-card: none`                     |
| `packages/ui/src/themes/material.css`           | Same, plus the dark-mode overlay shadow fix                             |
| `packages/ui/src/__tests__/contract.test.ts`    | 39 → 44 tokens                                                          |
| `packages/ui/src/__tests__/css-cascade.test.ts` | Ordering + retarget guards                                              |

---

### Task 1: Split pinned and group-row surfaces off the header token

`--pretable-bg-header` currently has six consumers: the header row, pinned header cells, group-row cells, left- and right-pinned body cells, and the number steppers. You cannot restyle a pinned data column without also restyling the header.

- [ ] **Step 1: Add the tokens to the contract list (failing test)**

In `packages/ui/src/__tests__/contract.test.ts`, after `"pretable-bg-header"`, add:

```ts
  "pretable-bg-pinned",
  "pretable-bg-group-row",
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @pretable/ui test -- contract`
Expected: FAIL — `--pretable-bg-pinned is empty` for both themes.

- [ ] **Step 3: Define them at today's values in both themes**

In `packages/ui/src/themes/excel.css` and `packages/ui/src/themes/material.css`, in the surfaces block, add:

```css
/* Pinned body cells and group rows historically borrowed --pretable-bg-header,
     which made it impossible to restyle a frozen data column without also
     restyling the header. They now have their own tokens, defaulted here to the
     value this theme already resolved so nothing moves. */
--pretable-bg-pinned: var(--pretable-bg-header);
--pretable-bg-group-row: var(--pretable-bg-header);
```

- [ ] **Step 4: Retarget the fills in `grid.css`**

Change **only these three** `background: var(--pretable-bg-header)` declarations:

- the group-row cell rule (`:where([data-pretable-group-row] [data-pretable-cell])`) → `var(--pretable-bg-group-row)`
- the left-pinned body cell rule (`[data-pretable-cell][data-pretable-pinned="left"]`) → `var(--pretable-bg-pinned)`
- the right-pinned body cell rule (`[data-pretable-cell][data-pretable-pinned="right"]`) → `var(--pretable-bg-pinned)`

**Leave the header row, the pinned HEADER cells, and the number steppers on `--pretable-bg-header`.** The pinned header cell must keep matching the header strip it sits in — `css-cascade.test.ts` has a test asserting exactly that, and it must keep passing.

- [ ] **Step 5: Add a guard**

In `css-cascade.test.ts`:

```ts
test("pinned body cells and group rows have their own surface tokens", () => {
  // They used to borrow --pretable-bg-header, which meant a theme could not
  // restyle a frozen data column without also restyling the header strip.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const pinnedBody = css.match(
    /:where\(\[data-pretable-cell\]\[data-pretable-pinned="left"\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(pinnedBody, "no left-pinned body rule").toBeDefined();
  expect(pinnedBody).toMatch(/background:\s*var\(--pretable-bg-pinned\)/);

  const groupRow = css.match(
    /:where\(\[data-pretable-group-row\] \[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(groupRow, "no group-row rule").toBeDefined();
  expect(groupRow).toMatch(/background:\s*var\(--pretable-bg-group-row\)/);
});
```

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @pretable/ui test` — all green, including the existing pinned-header test.

```bash
git add packages/ui/src/grid.css packages/ui/src/themes/excel.css packages/ui/src/themes/material.css packages/ui/src/__tests__/contract.test.ts packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "feat(ui): give pinned cells and group rows their own surface tokens"
```

---

### Task 2: Make row hover reach pinned cells (bug)

The row-hover rule is declared **before** the pinned-cell rules. All three are `(0,0,0)`, so the pinned fill wins on source order and hovering a row leaves its frozen columns unhighlighted — the row visibly breaks in half.

- [ ] **Step 1: Add the failing guard**

```ts
test("row hover is declared after the pinned surfaces so it reaches them", () => {
  // Everything here is :where()-flattened to (0,0,0), so source order is the
  // only cascade lever. Declared before the pinned rules, hover loses on
  // pinned cells and a hovered row visibly breaks in half at the frozen edge.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const pinned = css.indexOf(
    '[data-pretable-cell][data-pretable-pinned="left"]',
  );
  const hover = css.indexOf("[data-pretable-row]:hover [data-pretable-cell]");
  expect(pinned, "no pinned rule").toBeGreaterThan(-1);
  expect(hover, "no hover rule").toBeGreaterThan(-1);
  expect(hover, "hover must come after the pinned surfaces").toBeGreaterThan(
    pinned,
  );
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @pretable/ui test -- css-cascade`

- [ ] **Step 3: Move the hover rule**

Cut the whole `/* Hover */` rule — comment included — and paste it immediately **after** the right-pinned `border-left` rule (the last of the pinned-surface rules), before the selection rules. Extend its comment:

```css
/* Hover. Declared after the pinned surfaces on purpose: every selector here is
     :where()-flattened to (0,0,0), so source order is the only cascade lever,
     and a hover declared earlier loses on pinned cells — leaving a hovered row
     visibly broken in half at the frozen edge. Selection follows this rule for
     the same reason. */
```

The resulting order must read: base cell → zebra → group row → pinned → **hover** → selection → focus.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @pretable/ui test` — all green. The existing selection tests must still pass; selection is still last.

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "fix(ui): let row hover reach pinned cells"
```

---

### Task 3: A radius for small controls

`--pretable-radius` serves 12 sites, from the grid container to a 14px chip-remove button. Under Material's 12px, every small affordance is a circle.

- [ ] **Step 1: Add the token to the contract list, then confirm the failure**

Add `"pretable-radius-control"` after `"pretable-radius"` in `contract.test.ts`. Run `pnpm --filter @pretable/ui test -- contract` and confirm it fails for both themes.

- [ ] **Step 2: Define it**

- `excel.css`: `--pretable-radius-control: 0;` with a comment that Excel never rounds.
- `material.css`: `--pretable-radius-control: 6px;` with a comment that the card radius (12px) turns a 14–18px control into a circle.

- [ ] **Step 3: Retarget the small controls only**

Switch these from `var(--pretable-radius)` to `var(--pretable-radius-control)`: the filter funnel button, the column-menu button, the chip-remove button, the menu item, the calendar day, and the filter-menu inputs.

**Leave on `--pretable-radius`:** the scroll viewport, the group panel, the enum listbox, the date popover, the generic popover, and the group chip. Those are surfaces, not controls.

- [ ] **Step 4: Guard, verify, commit**

```ts
test("small controls use the control radius, surfaces use the card radius", () => {
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const funnel = css.match(
    /:where\(\[data-pretable-filter-funnel\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(funnel).toMatch(/border-radius:\s*var\(--pretable-radius-control\)/);
  const viewport = css.match(
    /:where\(\[data-pretable-scroll-viewport\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(viewport).toMatch(/border-radius:\s*var\(--pretable-radius\)/);
});
```

Run `pnpm --filter @pretable/ui test`, then commit as `feat(ui): add a control radius so small affordances stop rounding into circles`.

---

### Task 4: An elevation scale, and fix dark mode (bug)

There is one shadow token, `--pretable-reorder-ghost-shadow`, and four of its five uses are popovers. Material's dark block never overrides it, so every dark-mode overlay casts black onto a near-black surface and nothing reads as lifted.

- [ ] **Step 1: Rename, add two tokens, confirm the failure**

In `contract.test.ts`, replace `"pretable-reorder-ghost-shadow"` with `"pretable-shadow-overlay"`, and add `"pretable-shadow-card"` and `"pretable-shadow-seam"`. Run the contract test and confirm it fails.

- [ ] **Step 2: Update both themes**

Rename the token, and add:

```css
/* No card shadow: this theme draws a frame instead. pretable.css uses it. */
--pretable-shadow-card: none;
/* The frozen-column edge. Spread must be <= -blur/2 or the blur bleeds above
     and below each pinned cell and paints a dark band at every row boundary. */
--pretable-shadow-seam: 6px 0 10px -8px rgb(0 0 0 / 0.18);
```

Excel sets `--pretable-shadow-card: none` — it declares `--pretable-radius: 0` and must not float on a drop shadow.

- [ ] **Step 3: Fix Material dark**

In `material.css`'s `[data-theme="dark"]` block add a lifted overlay shadow — a black shadow on a `#1c1c1c` surface is invisible:

```css
--pretable-shadow-overlay: 0 4px 12px rgb(0 0 0 / 0.5);
```

- [ ] **Step 4: Update the five uses in `grid.css`**

Every `var(--pretable-reorder-ghost-shadow)` becomes `var(--pretable-shadow-overlay)`. Do **not** apply `--pretable-shadow-card` or `--pretable-shadow-seam` anywhere yet — they are declared for SP3. Note in the commit message that they are intentionally unused so far, because `contract.test.ts` is one-directional and will not flag them.

- [ ] **Step 5: Guard, verify, commit**

```ts
test("dark mode overrides the overlay shadow", () => {
  // A black shadow on a #1c1c1c surface is invisible; without an override
  // every dark-mode popover reads as flat.
  const css = fs.readFileSync(path.join(THEMES_DIR, "material.css"), "utf8");
  const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1];
  expect(dark, "no dark block").toBeDefined();
  expect(dark).toMatch(/--pretable-shadow-overlay:/);
});
```

Also assert `grid.css` no longer mentions `reorder-ghost-shadow`. Commit as `refactor(ui): rename the ghost shadow to an overlay shadow and add an elevation scale`.

---

### Task 5: Verification sweep

- [ ] **Step 1:** `pnpm --filter @pretable/ui test` — expect all green, token count now 44.
- [ ] **Step 2:** `pnpm --filter @pretable/react test` — expect 877 passing. Re-run once before believing a lone timeout; this suite flakes under load.
- [ ] **Step 3:** `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- [ ] **Step 4:** `pnpm --filter @pretable/app-bench build && pnpm exec playwright test apps/bench/tests/cascade-override.spec.ts --workers=1`. This is the gate that matters: jsdom cannot resolve layered custom properties, so only the browser can catch a cascade regression from the hover reorder.
- [ ] **Step 5: Confirm the themes did not move.** Rebuild `@pretable/ui`, load each theme plus `grid.css` in a browser, and confirm a plain body cell, a pinned cell and a group-row cell all compute the same `background-color` as before the change. The pinned and group tokens alias the header token, so any difference is a bug.
- [ ] **Step 6:** Commit any formatting churn.

## Self-review

**Spec coverage.** SP2a's spec bullets map: the pinned/group surface split → Task 1; the radius scale → Task 3; the shadow rename plus card and seam tokens plus the Material dark fix → Task 4. The `background-image` wash is explicitly dropped with reasoning in "Deliberately NOT doing". The pinned seam is _declared_ here and _applied_ in SP3, because applying it needs `pretable.css` to exist to be worth looking at. The container edge is likewise declared-not-applied.

**Not covered here, deliberately:** the dead focus-outline rule, which the spec assigns to SP2 — it belongs with the seam because both contend for `box-shadow` on a focused pinned cell, and neither is applied until SP3.

**Type consistency.** Token names are spelled identically across tasks: `--pretable-bg-pinned`, `--pretable-bg-group-row`, `--pretable-radius-control`, `--pretable-shadow-overlay`, `--pretable-shadow-card`, `--pretable-shadow-seam`. Count: 39 + 5 new − 1 renamed = **44**.
