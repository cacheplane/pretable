# Grid header on touch and keyboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grid's column-header controls usable by finger and by keyboard, by fixing the one cause behind five separately-filed defects.

**Architecture:** Header slot geometry moves from inline constants to CSS custom properties so a media query can re-space it; the resize strip is not rendered on coarse pointers; the header joins the grid's existing roving-tabindex focus model via a new `{kind: "header"}` ref variant.

**Tech Stack:** `@pretable/grid-core` (focus model), `@pretable/react` (surface + overlays), `@pretable/ui` (vanilla CSS), Playwright (Chromium + WebKit, iPhone 13 emulation).

**Spec:** `docs/superpowers/specs/2026-08-14-grid-header-touch-and-keyboard-design.md`

---

## Task 0 — GATE: is the grid body keyboard-reachable from cold? — **CONFIRMED**

**Verdict: CONFIRMED, and larger than the hypothesis. Task 3 is re-scoped behind
a new prerequisite project.**

Measured cold, before any input: **0 tabbable elements against 96 gridcells**.
Focus initialises to `{ref: null, columnId: null}` (`create-grid-ui-core.ts:305`),
so `cellIsFocused` never matches and every cell is `tabIndex={-1}`. The viewport
is `tabIndex={-1}` with no container fallback, and the viewport keydown bails
when the target is not a cell — so no key can seed focus either.

Three separable defects, two of them WCAG Level A:

1. **Entry (WCAG 2.1.1)** — the body is keyboard-unreachable, permanently. There
   is no keyboard route to the pointer interaction that would seed focus.
2. **Exit (WCAG 2.1.2, keyboard trap)** — once a cell has focus, the default
   `tabBehavior="wrap-rows"` consumes Tab and Shift+Tab unconditionally.
   **120 forward Tab presses never leave the grid**, both engines. Escape does
   not release. Independent of #1 and survives fixing it.
3. **Row-select divergence** — `activeElement` stays pinned to the row-select
   checkbox while the roving `tabIndex` and focus ring march across cells, because
   `isFocusOursToMove` (`:5717`) requires the element to *be* the cell.

`keyboard.mdx` asserts the broken invariant verbatim at `:53` ("exactly one cell
has `tabIndex={0}`"), plus false claims at `:7`, `:42`, `:49`.

**Consequence for this plan:** those three land FIRST, on their own branch, with
their own tests, as the spec's gate requires. Task 3 here (header joins the
focus model) builds on a focus model that must first be reachable and escapable.
Tasks 1, 2, 4 (touch) are unaffected and may proceed.

### RESOLVED — shipped in #423, so Task 3 is unblocked

All three were fixed and merged before this plan reached `main`. Verified in
both engines on a production build:

| | before | after |
|---|---|---|
| cold-start tabbable cells | 0 of 96 | **1** of 96 |
| Tab from outside → a data cell | never | **1** press (WebKit), 17 (Chromium) |
| Tab to escape a focused cell | never (120+) | **1** press, both |

Chromium's 17 is the 16 header buttons still being individual tab stops —
**that is exactly what Task 3 removes**, so it is the remaining symptom rather
than a regression.

Two things Task 3 inherits from that work:

- The default `tabBehavior` is now `"exit"`, and `"wrap-rows"` releases at the
  corners instead of clamping. Task 3 must not reintroduce a configuration that
  traps.
- `keyboard.mdx` has already been corrected once and test-pinned. Task 5's docs
  work edits a page that is now accurate — check what it says before rewriting.

Working precedent to follow: `GroupPanel.tsx:450` roves correctly with
`useState(0)`, so its first item is always tabbable.

## Task 1 — Header slot geometry becomes themeable

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (overlay anchor block, ~4712-4890)
- Modify: `packages/ui/src/grid.css`
- Test: `packages/ui/src/__tests__/css-cascade.test.ts`

The blocker is that the offsets are **inline styles** (`left: -22`, `left: -40`),
and inline style beats every stylesheet rule — `!important` and `@layer`
included. No media query can move them. The fix is for the inline style to read
a token.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/__tests__/css-cascade.test.ts`, assert the tokens exist and
that a coarse-pointer block redefines them:

```ts
it("defines header slot offsets as tokens, not hardcoded positions", () => {
  const css = readFileSync(GRID_CSS, "utf8");
  expect(css).toMatch(/--pt-header-funnel-slot:/);
  expect(css).toMatch(/--pt-header-menu-slot:/);
  // The whole point: a media query must be able to re-space them.
  expect(css).toMatch(/@media \(pointer: coarse\)/);
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm --filter @pretable/ui test`
Expected: FAIL — no such tokens today.

- [ ] **Step 3: Define the tokens in `grid.css`**

Fine pointer keeps today's geometry exactly (4px strip, funnel 22 back, menu 40
back). Coarse drops the strip and re-spaces to 24/48.

```css
:where([data-pretable-header-overlays]) {
  --pt-header-funnel-slot: -22px;
  --pt-header-menu-slot: -40px;
}
@media (pointer: coarse) {
  :where([data-pretable-header-overlays]) {
    --pt-header-funnel-slot: -24px;
    --pt-header-menu-slot: -48px;
  }
}
```

- [ ] **Step 4: Read the tokens from the inline styles**

Replace `left: -22` with `left: "var(--pt-header-funnel-slot)"` and
`left: showFilterFunnel ? -40 : -22` with a token whose fallback preserves the
no-funnel case. Keep the anchor maths in JS; only the offsets become tokens.

- [ ] **Step 5: Verify the fine-pointer geometry is byte-identical**

Run the hit-test sweep (Task 4) with `pointer: fine`. Funnel and menu must land
on exactly the same pixels as before this task. **This task must be a no-op on
desktop.**

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/grid.css packages/react/src/pretable-surface.tsx packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "refactor(ui): make header slot offsets themeable tokens"
```

---

## Task 2 — Touch behaviour

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/ui/src/grid.css`
- Test: new Playwright spec, iPhone 13 profile

- [ ] **Step 1: Write the failing tests** (all three, all currently red)

1. On `pointer: coarse`, no `[data-pretable-resize-handle]` is rendered.
2. On `pointer: coarse`, the funnel's computed `opacity` is `1` with no filter
   active and no hover. (Today it is `0` — measured.)
3. On `pointer: coarse`, funnel and column-menu tap targets are each >= 24x24,
   measured by hit-test sweep, **including under the group panel** — the case
   that currently yields ~17px width.

- [ ] **Step 2: Run them, confirm all three fail, record the output**

- [ ] **Step 3: Drop the resize strip on coarse pointers**

`showResizeHandle` gains a coarse-pointer condition. Prefer a CSS-driven
approach if it can make the element genuinely non-rendered/non-hit-testable;
if a media query cannot express it, use `matchMedia` with an SSR-safe default
and say so — a hydration mismatch here would be worse than the bug.

- [ ] **Step 4: Always-visible funnel on coarse pointers**

In `grid.css`, under `@media (pointer: coarse)`, the funnel's rest opacity is 1.
Do not touch the fine-pointer hover-reveal.

- [ ] **Step 5: 24px target on the column menu**

Same transparent `::after` technique the funnel already uses. **The glyph stays
18px and the header box must not change size** — `getDensityHeights` reads
header and row height in JS for virtualization geometry.

- [ ] **Step 6: Verify header/row height unchanged at all three densities**

On/off in the same layout frame, not across builds. Compact, standard, spacious.

- [ ] **Step 7: Commit**

---

## Task 3 — Header joins the focus model

**UNBLOCKED** — the prerequisite shipped in #423. See the Task 0 resolution
above for what changed and the two constraints this task inherits.

**Files:**
- Modify: `packages/grid-core/src/types.ts` (`PretableVisibleRowRef`)
- Modify: `packages/grid-core/src/indexed-focus.ts`
- Modify: `packages/grid-core/src/create-grid-ui-core.ts`
- Modify: `packages/react/src/pretable-surface.tsx`
- Test: `packages/grid-core/src/__tests__/`, plus a Playwright keyboard journey

- [ ] **Step 1: Enumerate every call site that switches on ref kind**

Before changing the type, list every `indexOf` / `nearestVisibleRef` / ref-kind
switch. Widening the union makes the compiler demand each one handle
`{kind: "header"}`. **A `default:` branch that swallows the new variant defeats
the entire point of this encoding** — the compiler forcing an explicit decision
at each site is why this approach was chosen over a nullable-ref hack.

Record the list in the commit message.

- [ ] **Step 2: Write the failing test — the assertion that would have caught all of this**

```ts
// A 5-column grid must be ONE tab stop. Today: 10 in Chromium, 0 in WebKit.
test("the grid is a single tab stop", async ({ page }) => {
  // …focus immediately before the grid, press Tab 16 times,
  // count how many stops land inside [data-pretable-scroll-viewport]
  expect(stopsInsideGrid).toBe(1);
});
```

- [ ] **Step 3: Run it in both engines, confirm it fails with 10 and 0**

- [ ] **Step 4: Widen `PretableVisibleRowRef` with `{kind: "header"}`**

`{ref: null, columnId}` was ruled out by verification, not argument:
`indexed-focus.ts:57` and three sibling sites normalize
`ref === null || columnId === null` to `emptyFocus()`, so it collapses to "no
focus" on the first round trip. Do not revisit that encoding.

- [ ] **Step 5: Movement**

ArrowUp from the top data row → header of the focused column. ArrowDown from the
header → first data row. Left/Right move between header columns.
`PretableIndexedFocusMovement` already carries `up`/`down`/`home`/`end`.

- [ ] **Step 6: Activation, and close the tab-order leak**

Enter/Space on a focused header sorts (as the header button does today).
Documented keys open the filter popover and the column menu. Header controls
become `tabIndex={-1}`.

This is a **leak being closed**, not a feature being added: the grid already
intercepts Tab in the body via `PretableIndexedFocusMovement`'s `tab`/`shift-tab`.
The header is the one place the browser's native order still shows through.

- [ ] **Step 7: Verify the tab-stop count is 1 in both engines**

- [ ] **Step 8: Commit**

---

## Task 4 — The verification harness

**Files:**
- Create: `apps/website/e2e/grid-header-touch.spec.ts`
- Create: `apps/website/e2e/grid-header-keyboard.spec.ts`

jsdom models neither Safari's tab-order policy nor pseudo-element geometry
(`getComputedStyle` with pseudo-elements is explicitly `Not implemented`) and
lays nothing out. These must be real-browser tests.

- [ ] **Step 1: Hit-test sweep helper**

`elementFromPoint` at 1px steps around each control — this measures the true tap
target including the pseudo-element. A computed `width` does not.

- [ ] **Step 2: Tab-stop counter helper**

- [ ] **Step 3: The matrix** — 3 densities x {coarse, fine} x {Chromium, WebKit}

- [ ] **Step 4: Assert a removed control is not a broken control**

With the resize strip gone on coarse pointers, resizing must still work under
`pointer: fine`. A test that only checks the strip is absent would pass if
resizing were broken everywhere.

- [ ] **Step 5: Mutation-prove every assertion**

Report what was mutated and what was seen. An assertion never watched failing is
not evidence.

- [ ] **Step 6: Commit**

---

## Task 5 — Docs

**Files:**
- Modify: `apps/website/content/docs/grid/keyboard.mdx`
- Modify: `apps/website/content/docs/grid/filtering.mdx` (touch behaviour)

- [ ] **Step 1: Re-check every existing key binding against the new model**

`keyboard.mdx` documents `Tab` and mentions the header only as scroll-occlusion
chrome, so it gains a section rather than contradicting itself — but the `Tab`
entry must be re-verified, not assumed still true.

- [ ] **Step 2: Document header navigation and the touch differences**

State plainly that resizing is a pointer affordance and the funnel is always
visible on touch.

- [ ] **Step 3: Verify every documented key actually works, in a browser**

Rendering a claim tests it. This has surfaced ~11 real defects in this repo.

- [ ] **Step 4: Commit**

---

## Definition of done

- [ ] A 5-column grid is **one** tab stop in Chromium and WebKit.
- [ ] Funnel and column menu are >= 24x24 on coarse pointers, including under
      the group panel.
- [ ] The funnel is visible on touch.
- [ ] No resize strip on coarse pointers; resizing still works on fine.
- [ ] Header and row heights unchanged at all three densities.
- [ ] Desktop geometry byte-identical to before.
- [ ] Full gate: `test`, `typecheck`, `typecheck:public`, `lint`, `format`,
      `build`, `api:check`.
- [ ] `.api.md` regenerated (the ref union is public) — `build` first, then
      `api` as the LAST step after the final `format`.
