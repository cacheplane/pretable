# SP1: Line Vocabulary & Numeric Alignment Implementation Plan

> **Post-implementation note (do not rewrite the plan below).** During implementation, in response
> to code review, the two new attributes were renamed `data-pretable-type` →
> `data-pretable-column-type` and `data-pretable-align` → `data-pretable-column-align`, so they sit
> in the same namespace as the existing `data-pretable-column-id`. This document is a
> point-in-time record and still uses the pre-rename spellings throughout — including the
> self-review claim that the names are "spelled identically in Tasks 4 and 5", which no longer
> describes shipped code. **The `data-pretable-column-*` names are authoritative**; see
> `packages/ui/README.md` and the design spec for the current contract.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grid's two line axes independently themeable, give numeric columns real alignment and tabular figures, and remove three rules that have never painted.

**Architecture:** Two new tokens (`--pretable-rule-vertical`, `--pretable-rule-width`) split the single `--pretable-rule` into the horizontal row hairline and the vertical column divider. Excel and Material both alias vertical back to `--pretable-rule`, so **neither theme changes appearance in this sub-project** — the capability is what SP3's house theme will use. Separately, `column.type` finally gets a display-side consequence: the surface emits `data-pretable-type` and `data-pretable-align`, and `grid.css` aligns with `justify-content` (not `text-align`, which cannot move an anonymous flex item).

**Tech Stack:** vanilla CSS in `@pretable/ui` (no Tailwind, no CSS-in-JS), React 19 + TypeScript in `@pretable/react`, vitest + jsdom for unit tests, Playwright for the real-browser cascade gate, API Extractor for the public-API gate.

---

## Constraints that bite

- `packages/ui/src/grid.css` lives entirely inside `@layer pretable` and **every selector must be wrapped in `:where()`** — `css-cascade.test.ts:155-168` enumerates every selector in the file and fails any that isn't.
- `contract.test.ts:168-195` requires every `var(--pretable-*)` referenced by `grid.css` to resolve non-empty at `:root` under **both** themes. A new token used in CSS but missing from one theme fails there.
- Adding a field to `PretableColumn` changes the public API reports. `API Extractor — report freshness` is a **required** CI check. Always `pnpm build` before `pnpm api`, or a stale `dist/` silently strips exports and the regenerated report is wrong.
- The header's inline `textAlign: "left"` at `packages/react/src/pretable-surface.tsx:2986` **stays**. It blocks nothing (`justifyContent` is not in that inline style), and removing it exposes the UA `button { text-align: center }` on every column.

## File structure

| File                                                 | Responsibility                         | Change                                                                  |
| ---------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `packages/ui/src/themes/excel.css`                   | Excel token values                     | Modify — add 2 tokens                                                   |
| `packages/ui/src/themes/material.css`                | Material token values                  | Modify — add 2 tokens                                                   |
| `packages/ui/src/grid.css`                           | The selector-based skin                | Modify — retint borders, add align + numeral rules, delete 3 dead rules |
| `packages/ui/src/__tests__/contract.test.ts`         | Token presence + resolution            | Modify — add 2 tokens to `TOKENS`                                       |
| `packages/ui/src/__tests__/css-cascade.test.ts`      | Cascade + structural guards            | Modify — retarget header assertion, add 4 new assertions                |
| `packages/ui/README.md`                              | Public attribute contract              | Modify — remove the false `data-pretable-numeric` claim                 |
| `packages/grid-core/src/types.ts`                    | `PretableColumn` shape                 | Modify — add `align?`                                                   |
| `packages/react/src/column-align.ts`                 | Resolve a column's effective alignment | **Create**                                                              |
| `packages/react/src/pretable-surface.tsx`            | Body + header cell attribute emission  | Modify — 2 sites                                                        |
| `packages/react/src/group-row.tsx`                   | Group-row aggregate cell attributes    | Modify — 1 site                                                         |
| `packages/react/src/__tests__/column-align.test.tsx` | Attribute emission behavior            | **Create**                                                              |

Out of scope, deliberately: the focus-outline rule at `grid.css:220-223` is also dead on data cells (an inline `outline: "none"` at `pretable-surface.tsx:3541` neutralizes it) while giving group cells a doubled ring. Removing it changes which mechanism draws the focus ring, so it belongs with SP2, where the ring is being reconsidered alongside the seam shadow that shares the `box-shadow` channel.

---

### Task 1: Add the two line tokens to both themes

**Files:**

- Modify: `packages/ui/src/__tests__/contract.test.ts:14-15`
- Modify: `packages/ui/src/themes/excel.css:24-26`
- Modify: `packages/ui/src/themes/material.css:22-24`

- [ ] **Step 1: Add the tokens to the contract list (failing test)**

In `packages/ui/src/__tests__/contract.test.ts`, in the `TOKENS` array, replace:

```ts
  "pretable-rule",
  "pretable-rule-strong",
```

with:

```ts
  "pretable-rule",
  "pretable-rule-strong",
  "pretable-rule-vertical",
  "pretable-rule-width",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/ui test -- contract`

Expected: FAIL, twice — `excel.css: --pretable-rule-vertical is empty` and the same for `material.css`.

- [ ] **Step 3: Define them in Excel**

In `packages/ui/src/themes/excel.css`, in the `/* Lines */` block, after the `--pretable-rule-strong` line, add:

```css
/* Excel draws the full cage: the vertical divider tracks the horizontal rule.
     A theme that wants horizontal-only separation sets this to `transparent`. */
--pretable-rule-vertical: var(--pretable-rule);
--pretable-rule-width: 1px;
```

- [ ] **Step 4: Define them in Material**

In `packages/ui/src/themes/material.css`, in the `/* Lines */` block, after the `--pretable-rule-strong` line, add:

```css
/* Aliased to --pretable-rule so this theme's appearance is unchanged by the
     axis split. Material's own list spec has no vertical rules; revisiting that
     is a deliberate change, not a side effect of introducing the token. */
--pretable-rule-vertical: var(--pretable-rule);
--pretable-rule-width: 1px;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @pretable/ui test -- contract`

Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/__tests__/contract.test.ts packages/ui/src/themes/excel.css packages/ui/src/themes/material.css
git commit -m "feat(ui): add --pretable-rule-vertical and --pretable-rule-width tokens"
```

---

### Task 2: Retint the vertical borders in grid.css

**Files:**

- Modify: `packages/ui/src/__tests__/css-cascade.test.ts:37-46`
- Modify: `packages/ui/src/grid.css:55`, `:93-94`, `:210`

- [ ] **Step 1: Retarget the header-border guard (failing test)**

In `packages/ui/src/__tests__/css-cascade.test.ts`, replace the whole `test("header cells reset the button border before drawing the tokenized divider", ...)` body's final assertion:

```ts
expect(rule).toMatch(
  /border:\s*0;[\s\S]*border-right:\s*1px solid var\(--pretable-rule\)/,
);
```

with:

```ts
expect(rule).toMatch(
  /border:\s*0;[\s\S]*border-right:\s*var\(--pretable-rule-width\) solid var\(--pretable-rule-vertical\)/,
);
```

- [ ] **Step 2: Add a guard that the two axes are actually independent**

In the same file, immediately after that test, add:

```ts
test("the row hairline and the column divider read different tokens", () => {
  // The whole point of the split: a theme must be able to drop the vertical
  // cage without also erasing row separation. If both axes resolve to the
  // same token again, that capability is silently gone.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const cellRule = css.match(
    /:where\(\[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(cellRule, "no [data-pretable-cell] rule found").toBeDefined();
  expect(cellRule).toMatch(
    /border-right:\s*var\(--pretable-rule-width\) solid var\(--pretable-rule-vertical\)/,
  );
  expect(cellRule).toMatch(
    /border-bottom:\s*var\(--pretable-rule-width\) solid var\(--pretable-rule\)/,
  );
});
```

- [ ] **Step 3: Run to verify both fail**

Run: `pnpm --filter @pretable/ui test -- css-cascade`

Expected: FAIL on both `header cells reset the button border...` and `the row hairline and the column divider read different tokens`.

- [ ] **Step 4: Retint the header cell divider**

In `packages/ui/src/grid.css`, in the `:where([data-pretable-header-cell])` rule, replace:

```css
border-right: 1px solid var(--pretable-rule);
```

with:

```css
border-right: var(--pretable-rule-width) solid var(--pretable-rule-vertical);
```

- [ ] **Step 5: Retint the body cell borders**

In the `:where([data-pretable-cell])` rule, replace:

```css
border-right: 1px solid var(--pretable-rule);
border-bottom: 1px solid var(--pretable-rule);
```

with:

```css
border-right: var(--pretable-rule-width) solid var(--pretable-rule-vertical);
border-bottom: var(--pretable-rule-width) solid var(--pretable-rule);
```

- [ ] **Step 6: Retint the right-pinned leading edge**

In the rule whose selector is `:where([data-pretable-cell]:not([data-pretable-pinned="right"]) + [data-pretable-cell][data-pretable-pinned="right"])`, replace:

```css
border-left: 1px solid var(--pretable-rule);
```

with:

```css
border-left: var(--pretable-rule-width) solid var(--pretable-rule-vertical);
```

- [ ] **Step 7: Run the ui suite to verify everything passes**

Run: `pnpm --filter @pretable/ui test`

Expected: PASS. In particular `grid.css has no unresolved var(--pretable-*) refs under excel.css` and `...under material.css` must both pass — they prove the new tokens resolve.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "refactor(ui): draw column dividers from the vertical rule token"
```

---

### Task 3: Fix the header button background (bug)

Header cells render as `<button>`. The rule that styles them sets `border: 0` but never a background, so the browser's own button fill paints unless the consumer ships a CSS reset. Both apps only look correct because they import Tailwind's Preflight.

**Files:**

- Modify: `packages/ui/src/__tests__/css-cascade.test.ts`
- Modify: `packages/ui/src/grid.css:47-57`

- [ ] **Step 1: Add the failing test**

In `packages/ui/src/__tests__/css-cascade.test.ts`, after the `header cells take their text color from the header token` test, add:

```ts
test("header cells reset the UA button background", () => {
  // Header cells are <button> (pretable-surface.tsx). Without this reset the
  // UA ButtonFace fill paints, and the grid only looks right in apps that
  // happen to ship a reset — both of ours import Tailwind Preflight, which is
  // why this went unnoticed. Every other button in the file resets explicitly.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const rule = css.match(
    /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
  expect(rule).toMatch(/background:\s*transparent/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/ui test -- css-cascade`

Expected: FAIL — `header cells reset the UA button background`.

- [ ] **Step 3: Add the reset**

In `packages/ui/src/grid.css`, in the `:where([data-pretable-header-cell])` rule, add `background: transparent;` immediately before the `border: 0;` line, so the rule reads:

```css
:where([data-pretable-header-cell]) {
  display: flex;
  align-items: center;
  padding: 0 var(--pretable-cell-padding-x);
  font-size: var(--pretable-font-size-header);
  font-weight: 500;
  color: var(--pretable-text-header);
  background: transparent;
  border: 0;
  border-right: var(--pretable-rule-width) solid var(--pretable-rule-vertical);
  box-sizing: border-box;
}
```

The pinned-header rule that follows still wins for pinned cells — it is later in source at equal `(0,0,0)` specificity — so `pinned header cells get an opaque background, both sides` keeps passing.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/ui test`

Expected: PASS, including the pinned-header test.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "fix(ui): reset the UA button background on header cells"
```

---

### Task 4: Emit `data-pretable-type` and `data-pretable-align`

**Files:**

- Modify: `packages/grid-core/src/types.ts:112-119`
- Create: `packages/react/src/column-align.ts`
- Create: `packages/react/src/__tests__/column-align.test.tsx`
- Modify: `packages/react/src/pretable-surface.tsx` (body cell ~`:3417`, header cell ~`:2760`)
- Modify: `packages/react/src/group-row.tsx` (aggregate cell)

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/__tests__/column-align.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { resolveColumnAlign } from "../column-align";

describe("resolveColumnAlign", () => {
  test("number columns default to end", () => {
    expect(resolveColumnAlign({ type: "number" })).toBe("end");
  });

  test("text columns get no alignment attribute", () => {
    expect(resolveColumnAlign({ type: "text" })).toBeUndefined();
  });

  test("an untyped column gets no alignment attribute", () => {
    expect(resolveColumnAlign({})).toBeUndefined();
  });

  test("an explicit align always wins over the type default", () => {
    expect(resolveColumnAlign({ type: "number", align: "start" })).toBe(
      "start",
    );
    expect(resolveColumnAlign({ type: "text", align: "center" })).toBe(
      "center",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/react test -- column-align`

Expected: FAIL — cannot resolve `../column-align`.

- [ ] **Step 3: Add `align` to the column type**

In `packages/grid-core/src/types.ts`, inside `interface PretableColumn`, after the `type?: ColumnType;` line, add:

```ts
  /**
   * Horizontal alignment of this column's cells and header label. Defaults to
   * `"end"` for `type: "number"` and to the writing direction otherwise.
   */
  align?: "start" | "center" | "end";
```

- [ ] **Step 4: Create the resolver**

Create `packages/react/src/column-align.ts`:

```ts
import type { ColumnType } from "@pretable/grid-core";

export type ColumnAlign = "start" | "center" | "end";

/**
 * A column's effective alignment. Numbers align to the trailing edge so digits
 * of differing magnitude line up; everything else follows the writing
 * direction, which is the browser default and needs no attribute.
 *
 * Returning `undefined` rather than `"start"` for the default keeps the
 * attribute off the overwhelming majority of cells — one fewer string written
 * per cell per render across a virtualized grid.
 */
export function resolveColumnAlign(column: {
  align?: ColumnAlign;
  type?: ColumnType;
}): ColumnAlign | undefined {
  if (column.align) return column.align;
  return column.type === "number" ? "end" : undefined;
}
```

If `@pretable/grid-core` is not the import specifier used elsewhere in `packages/react/src`, match whatever `pretable-surface.tsx` already uses for `ColumnType`.

- [ ] **Step 5: Run to verify the unit test passes**

Run: `pnpm --filter @pretable/react test -- column-align`

Expected: PASS, 4 tests.

- [ ] **Step 6: Emit the attributes on body cells**

In `packages/react/src/pretable-surface.tsx`, import the resolver at the top with the other local imports:

```ts
import { resolveColumnAlign } from "./column-align";
```

In the body-cell JSX, immediately after the `data-pretable-wrap={column.wrap ? "true" : undefined}` line, add:

```tsx
                    data-pretable-type={column.type}
                    data-pretable-align={resolveColumnAlign(column)}
```

- [ ] **Step 7: Emit the attributes on header cells**

In the same file, in the header-cell JSX, immediately after the `data-pretable-pinned={plannedCol.pinned}` line (the one directly below `data-pretable-column-id={column.id}` in the `<button data-pretable-header-cell="">` element), add:

```tsx
              data-pretable-type={column.type}
              data-pretable-align={resolveColumnAlign(column)}
```

Do **not** touch the inline `style={{ ... textAlign: "left", ... }}` on that button.

- [ ] **Step 8: Emit the attributes on group-row aggregate cells**

In `packages/react/src/group-row.tsx`, on the cell element that already carries `data-pretable-cell`, add the same two attributes, importing `resolveColumnAlign` from `"./column-align"`. The group column itself carries no `type`, so it resolves to `undefined` and stays unattributed.

- [ ] **Step 9: Extend the test with a rendered-DOM assertion**

Append to `packages/react/src/__tests__/column-align.test.tsx` a render test that mounts `PretableSurface` with one `type: "number"` column and one `type: "text"` column, then asserts:

```tsx
const numericCell = container.querySelector(
  '[data-pretable-cell][data-pretable-column-id="amount"]',
);
expect(numericCell?.getAttribute("data-pretable-type")).toBe("number");
expect(numericCell?.getAttribute("data-pretable-align")).toBe("end");

const textCell = container.querySelector(
  '[data-pretable-cell][data-pretable-column-id="name"]',
);
expect(textCell?.getAttribute("data-pretable-type")).toBe("text");
expect(textCell?.getAttribute("data-pretable-align")).toBeNull();
```

Copy the mount boilerplate (rows, columns, container sizing, act wrapper) from an existing surface test — `packages/react/src/__tests__/attribute-contract.test.tsx` is the closest match and already renders a minimal grid.

- [ ] **Step 10: Run the react suite**

Run: `pnpm --filter @pretable/react test`

Expected: PASS. `attribute-contract.test.tsx` must stay green — it bans styling `data-*` attributes that are **not** `data-pretable-` prefixed, and both new attributes are.

- [ ] **Step 11: Regenerate the public API reports**

```bash
pnpm build && pnpm api
```

Expected: `packages/core/core.api.md` and `packages/react/react.api.md` gain the `align?: "start" | "center" | "end";` line. Building first is mandatory — API Extractor reads `dist/`.

- [ ] **Step 12: Verify the API gate passes**

Run: `pnpm api:check`

Expected: PASS, no drift reported.

- [ ] **Step 13: Commit**

```bash
git add packages/grid-core/src/types.ts packages/react/src/column-align.ts packages/react/src/__tests__/column-align.test.tsx packages/react/src/pretable-surface.tsx packages/react/src/group-row.tsx packages/core/core.api.md packages/react/react.api.md
git commit -m "feat(react): emit data-pretable-type and data-pretable-align from column.type"
```

---

### Task 5: Align numeric columns and give them tabular figures

**Files:**

- Modify: `packages/ui/src/__tests__/css-cascade.test.ts`
- Modify: `packages/ui/src/grid.css:239-245` (replace the dead numeric rule)
- Modify: `packages/ui/README.md:54`

- [ ] **Step 1: Add the failing tests**

In `packages/ui/src/__tests__/css-cascade.test.ts`, add:

```ts
test("alignment uses justify-content, and the trailing edge is safe", () => {
  // Cells are flex containers (`display: flex`) and an unwrapped cell value is
  // an anonymous flex item, which `text-align` cannot move — only
  // `justify-content` can. And plain `flex-end` clips an over-wide value at
  // its LEADING edge under `overflow: hidden`, rendering 1,234,567 as a
  // legible, plausible, WRONG 34,567. `safe` falls back to start-alignment
  // rather than overflowing the start edge.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const rule = css.match(
    /:where\(\[data-pretable-cell\]\[data-pretable-align="end"\][\s\S]*?\{([\s\S]*?)\}/,
  )?.[1];
  expect(rule, "no align=end rule found").toBeDefined();
  expect(rule).toMatch(/justify-content:\s*safe flex-end/);
  expect(rule).not.toMatch(/text-align/);
});

test("numeric and date cells get tabular figures without changing family", () => {
  const css = fs.readFileSync(GRID_CSS, "utf8");
  expect(css).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums/);
  // One family throughout. The old rule swapped in the mono stack, which put
  // a typographic seam down every numeric column.
  expect(css).not.toMatch(/data-pretable-numeric/);
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm --filter @pretable/ui test -- css-cascade`

Expected: FAIL on both — no align rule exists, and `data-pretable-numeric` is still present.

- [ ] **Step 3: Replace the dead numeric rule**

In `packages/ui/src/grid.css`, delete this rule entirely:

```css
/* Numeric cells (opt-in via [data-pretable-numeric="true"]) */
:where([data-pretable-cell][data-pretable-numeric="true"]) {
  font-family: var(--pretable-font-mono);
  text-align: right;
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}
```

and put this in its place:

```css
/* Column alignment.
     `justify-content`, not `text-align`: cells are flex containers and an
     unwrapped value is an anonymous flex item, which text-align cannot move.
     `safe`, not bare `flex-end`: with `overflow: hidden` and `nowrap`, a value
     wider than its column would otherwise overflow and be clipped at its
     LEADING edge — 1,234,567 renders as a legible, plausible, wrong 34,567.
     `safe` degrades to start-alignment in exactly that case, so the truncation
     stays visible at the trailing edge where a reader expects it.
     Group cells are excluded: they own the twisty indent. */
:where(
  [data-pretable-cell][data-pretable-align="end"]:not(
      [data-pretable-group-cell]
    ),
  [data-pretable-header-cell][data-pretable-align="end"]
) {
  justify-content: safe flex-end;
}

:where(
  [data-pretable-cell][data-pretable-align="center"]:not(
      [data-pretable-group-cell]
    ),
  [data-pretable-header-cell][data-pretable-align="center"]
) {
  justify-content: safe center;
}

/* Tabular, lining figures so digits line up down the column and share a
     common height. Deliberately NOT a font-family switch — one family
     throughout; the numerals do the aligning. */
:where(
  [data-pretable-cell][data-pretable-type="number"],
  [data-pretable-cell][data-pretable-type="date"]
) {
  font-variant-numeric: tabular-nums lining-nums;
}
```

- [ ] **Step 4: Correct the README's public claim**

In `packages/ui/README.md`, on the attribute-contract line, remove `, and `[data-pretable-cell][data-pretable-numeric="true"]`` and replace it with `, `[data-pretable-cell][data-pretable-type="number"]`, and `[data-pretable-cell][data-pretable-align="end"]``.

- [ ] **Step 5: Run the ui suite**

Run: `pnpm --filter @pretable/ui test`

Expected: PASS. The `every grid.css rule selector is wrapped in :where()` guard covers the three new rules; if it fails, a selector list lost its `:where(` prefix.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts packages/ui/README.md
git commit -m "feat(ui): right-align numeric columns on tabular figures"
```

---

### Task 6: Delete the rules that have never painted

Two deletions, both provable rather than suspected.

**Files:**

- Modify: `packages/ui/src/__tests__/css-cascade.test.ts`
- Modify: `packages/ui/src/grid.css:213-217` and `:247-253`

- [ ] **Step 1: Add the failing test**

In `packages/ui/src/__tests__/css-cascade.test.ts`, add:

```ts
test("the selected-cell rule sets color only, not background", () => {
  // @pretable/react sets `aria-selected` and `data-pretable-selected` from
  // the same condition, and :where([role="gridcell"][aria-selected="true"])
  // follows this rule at equal (0,0,0) specificity — so a `background` here
  // has never painted. The `color` line HAS: nothing else sets a color on a
  // selected cell.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  const rule = css.match(
    /:where\(\[data-pretable-cell\]\[data-pretable-selected="true"\]\)\s*\{([\s\S]*?)\}/,
  )?.[1];
  expect(rule, "no selected-cell rule found").toBeDefined();
  expect(rule).toMatch(/color:\s*var\(--pretable-text-selected\)/);
  expect(rule).not.toMatch(/background/);
});

test("grid.css styles no element the surface cannot emit", () => {
  // [data-pretable-toolbar] and [data-pretable-status-bar] were styled from
  // day one and are emitted by nothing in @pretable/react — verified by grep
  // across every .ts/.tsx/.mdx in the repo. Dead skin invites consumers to
  // target a contract that does not exist.
  const css = fs.readFileSync(GRID_CSS, "utf8");
  expect(css).not.toMatch(/data-pretable-toolbar/);
  expect(css).not.toMatch(/data-pretable-status-bar/);
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm --filter @pretable/ui test -- css-cascade`

Expected: FAIL on both.

- [ ] **Step 3: Reduce the selection rule to its live declaration**

In `packages/ui/src/grid.css`, replace:

```css
/* Selection — wins over zebra/hover via source order (they precede it) */
:where([data-pretable-cell][data-pretable-selected="true"]) {
  background: var(--pretable-bg-selected);
  color: var(--pretable-text-selected);
}
```

with:

```css
/* Selection text color. The selection FILL is drawn by the
     [role="gridcell"][aria-selected="true"] rule below: @pretable/react sets
     `aria-selected` and `data-pretable-selected` from the same condition, and
     that rule follows this one at equal (0,0,0) specificity, so a `background`
     declared here could never win. Only the color is load-bearing — nothing
     else sets a color on a selected cell. */
:where([data-pretable-cell][data-pretable-selected="true"]) {
  color: var(--pretable-text-selected);
}
```

- [ ] **Step 4: Delete the toolbar rule**

Delete this rule entirely:

```css
/* Toolbar / status bar — applied if engine wraps in named data attribute */
:where([data-pretable-toolbar], [data-pretable-status-bar]) {
  background: var(--pretable-bg-toolbar);
  color: var(--pretable-text-dim);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
}
```

`--pretable-bg-toolbar` stays in the contract — the drag-to-group panel reads it.

- [ ] **Step 5: Run the full ui suite**

Run: `pnpm --filter @pretable/ui test`

Expected: PASS. The unresolved-refs guard confirms no token lost its last consumer in a way that breaks resolution.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "refactor(ui): delete grid rules that never painted"
```

---

### Task 7: Full verification sweep

- [ ] **Step 1: Typecheck the workspace**

Run: `pnpm typecheck`

Expected: PASS. The `align?` addition is the only type-surface change.

- [ ] **Step 2: Lint**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 3: Format**

Run: `pnpm format:write && pnpm format`

Expected: the check passes. Prettier reformats CSS selector lists, so run this before the final commit rather than fighting it by hand.

- [ ] **Step 4: Run every package test**

Run: `pnpm -r --filter './packages/*' test`

Expected: PASS. Note that the react suite times out on one or two random tests under load — re-run before believing a failure, and confirm the same test fails twice before investigating.

- [ ] **Step 5: Verify the API gate**

Run: `pnpm api:check`

Expected: PASS.

- [ ] **Step 6: Run the real-browser cascade gate**

Run: `pnpm --filter @pretable/app-bench build && pnpm exec playwright test apps/bench/tests/cascade-override.spec.ts --workers=1`

Expected: PASS. This is the gate that matters most for this sub-project — jsdom does not resolve layered custom properties, so it cannot catch a cascade regression in the border retint.

- [ ] **Step 7: Confirm the themes did not move**

Run the bench at `apps/bench` and confirm by eye that the Excel-themed grid is pixel-unchanged: full gridlines, 20px rows, sharp corners. Then in the browser console:

```js
getComputedStyle(document.querySelector("[data-pretable-cell]"))
  .borderRightColor;
```

Expected: `rgb(212, 212, 212)` — identical to before the split, because Excel aliases the vertical token to `--pretable-rule`.

- [ ] **Step 8: Commit any formatting churn**

```bash
git add -A
git commit -m "style: prettier formatting after the line-vocabulary split"
```

---

## Self-review

**Spec coverage.** SP1's spec bullets map to tasks as follows: the rule-vocabulary split → Tasks 1-2; `align` on `PretableColumn` plus attribute emission → Task 4; `justify-content` with `safe flex-end` → Task 5; keeping the header's inline `textAlign` → Task 4 Step 7 (explicit "do not touch"); tabular figures without the mono switch → Task 5; deleting the dead numeric rule and correcting the README → Task 5; the header-button background bug → Task 3; the dead toolbar rules and the never-painting selection background → Task 6; excluding group cells from align → Task 5's selector. The guard updates called out in the spec (`css-cascade.test.ts:43-45`, `contract.test.ts`, API reports) are Tasks 2, 1, and 4 respectively.

One spec item is deliberately **not** covered here and is called out in the File Structure section: the dead focus-outline rule moves to SP2, because removing it changes which mechanism draws the ring and SP2's seam shadow shares the `box-shadow` channel with it.

**Placeholder scan.** No TBDs. Two steps delegate boilerplate to a named existing file rather than restating it — Task 4 Step 9 (mount boilerplate from `attribute-contract.test.tsx`) and Task 4 Step 4's import-specifier note. Both name the exact file to copy from.

**Type consistency.** `resolveColumnAlign` and the `ColumnAlign` type are defined once in Task 4 Step 4 and referenced by that same name in Steps 6, 7, and 8. The attribute names `data-pretable-type` and `data-pretable-align` are spelled identically in Tasks 4 and 5. The token names `--pretable-rule-vertical` and `--pretable-rule-width` are spelled identically in Tasks 1, 2, and 3.
