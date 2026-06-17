# Homepage showcase strip — design

**Date:** 2026-06-16
**Branch:** `claude/zealous-davinci-6c354a` (PR #176 lineage)
**Status:** approved (pending written-spec review)

## Goal

Make the homepage the canonical pretable demo by adding two **live, interactive**
proof sections below the hero. Today the marketing copy _claims_ virtualization
and column layout, but nothing on the page lets a visitor exercise them. This is
sub-project B of the "homepage as canonical demo" effort (sub-project A — the
hero cockpit — already shipped on PR #176).

Two focused sections, each proving exactly one thing:

1. **Scale** — column + row virtualization on a 2,500 × 500 grid (1.25M cells)
   with a live "cells in the DOM" counter.
2. **Column layout** — drag-to-resize and drag-to-reorder columns, with a reset.

## Non-goals (explicitly out of scope)

- **Theming / dark mode / density switcher** — deferred. It overlaps the open
  "theming architecture for consumers" design question and should wait for that
  brainstorm.
- **Headless `usePretable` / `createGrid` example** — already covered by a live
  example in the docs "Headless engine" section; duplicating it on the homepage
  adds no value.
- **Any `packages/*` changes.** This is a website-only sub-project. The surface
  already exposes everything we need (column virtualization is automatic; resize
  and reorder are built-in drag interactions).
- Multi-sort, pinning, paste, grouping (tracked elsewhere).

## Where it lives

Two new sections in the homepage drawer flow in `app/page.tsx`, each wrapped in
the existing `<ScrollReveal>` like every other marketing section, inserted
**after `<FeatureGrid>` and before `<CtaSection>`** (proof points just before the
call to action):

```tsx
<ScrollReveal><FeatureGrid /></ScrollReveal>
<ScrollReveal><ScaleShowcase /></ScrollReveal>          {/* new */}
<ScrollReveal><ColumnLayoutShowcase /></ScrollReveal>   {/* new */}
<ScrollReveal><CtaSection /></ScrollReveal>
```

Each section follows the existing section pattern (Tailwind + design tokens:
`text-text-primary`, `bg-bg-card`, `border-rule`, `accent`, `font-display`,
`font-mono`; a numbered eyebrow continuing the existing sequence — match whatever
number `FeatureGrid` lands on and increment).

## Lazy mounting

`ScrollReveal` only animates opacity — its children mount immediately on page
load. A 2,500 × 500 grid must **not** mount until scrolled near, or it taxes
initial load. So each showcase's interactive grid self-gates mounting with its
own `IntersectionObserver` via a small shared `useInView` hook: until the section
is near the viewport, render a fixed-height placeholder (same height as the grid,
to avoid layout shift); once in view, mount the real grid. One-shot — once
mounted it stays mounted.

## Section 1 — Scale

### Component structure

- `app/components/ScaleShowcase.tsx` — server component: eyebrow, heading, copy,
  and the `<ScaleGrid>` client island. Tailwind chrome only.
- `app/components/showcase/ScaleGrid.tsx` — `"use client"`: the `<PretableSurface>`
  plus the live counter. Self-gates mounting via `useInView`.
- `app/components/showcase/scaleData.ts` — pure data generators (no React).
- `app/components/showcase/useRenderedCellCount.ts` — the DOM-count hook.
- `app/components/showcase/useInView.ts` — shared lazy-mount hook.
- `app/components/showcase/scaleGrid.module.css` — viewport sizing / counter
  layout (CSS module, consistent with `heroGrid`).

### Data (memory stays tiny)

`scaleData.ts` exports:

- `ROW_COUNT = 2500`, `COL_COUNT = 500`.
- `makeScaleRows(): ScaleRow[]` — 2,500 lightweight `{ i: number }` objects
  (`getRowId = (r) => String(r.i)`). Nothing per-cell is materialized.
- `makeScaleColumns(): PretableColumn<ScaleRow>[]` — 500 column defs, each with a
  **lazy value accessor** `value: (row) => synth(row.i, colIndex)` where `synth`
  is a cheap deterministic function (e.g. a small integer/decimal from
  `(rowIndex * 31 + colIndex * 17) % N`). Headers `C1 … C500`. A fixed width
  (~90px) so 500 columns force horizontal scroll. First column slightly wider and
  labeled (e.g. `Row`) showing `row.i` so the grid is legible while scrolling.

The model holds 2,500 small objects + 500 column defs — a few hundred KB. The
1.25M figure is conceptual (cells = rows × cols), never allocated.

### The grid

A single `<PretableSurface<ScaleRow>>` with `columns`, `rows`, `getRowId`,
`viewportHeight` (a fixed number, e.g. 420), inside a bordered container that
scrolls both axes. **Column virtualization is automatic** — the surface measures
its own width and renders only visible columns (verified: `pretable-surface.tsx`
measures `viewportWidth` internally and feeds it to the render snapshot). Row
virtualization is likewise automatic. No controlled `state` → no
`usePretable` controlled-state warning.

Columns/rows are created once (`useMemo([], …)`) so the grid instance is stable.

### The counter (the proof)

`useRenderedCellCount(scrollViewportRef)` returns the count of
`[data-pretable-cell]` nodes currently in the DOM. Implementation: a ref to the
scroll viewport; on `scroll` (rAF-throttled) and on mount, read
`el.querySelectorAll("[data-pretable-cell]").length`. This is the **literal**
rendered-cell count — honest, not derived.

Display, prominently near the grid:

> **1,250,000** cells in the model · **~160** rendered in the DOM

Format the model number with thousands separators. The rendered number updates
live as you scroll — it stays small (~150–200) no matter how far you scroll. The
caption ties it to the published benchmark ("matches our 2,500 × 500 bench, ~160
peak DOM nodes").

## Section 2 — Column layout

### Component structure

- `app/components/ColumnLayoutShowcase.tsx` — server component: eyebrow, heading,
  copy, instructions, and the `<ColumnLayoutGrid>` client island.
- `app/components/showcase/ColumnLayoutGrid.tsx` — `"use client"`: the grid + a
  "Reset layout" button. Self-gates mounting via `useInView`.
- `app/components/showcase/columnLayoutData.ts` — a small readable
  **portfolio-style slice** (recognizable headers read far better than `C1…C8`
  and tie to the brand; the scale grid stays generic).
- reuse `useInView.ts`.

### Data

~8 columns (Symbol, Sector, Qty, Last, Mkt Value, Day P&L, Weight, Analyst-style
note) × ~12 static rows. Plain static arrays — no streaming, no derivation. This
is a layout demo, so the data just needs to be legible. (Hand-authored constant;
may borrow shape from the hero's `PositionRow` but does not import the streaming
machinery.)

### Resize + reorder (uncontrolled)

The surface's built-in drag interactions handle both: drag a column border to
resize, drag a header to reorder. We run them **uncontrolled** — no `state`
prop — so the grid owns the layout internally and there's no controlled-state
warning. (`copyWithHeaders`/selection not needed here; keep it minimal.)

**Reset layout** restores defaults by remounting the grid: a `resetKey` state,
bumped on click, used as the React `key` on `<PretableSurface>`. Remount → fresh
default columns/widths/order. Clean and warning-free.

Instruction line under the grid: "drag a column border to resize · drag a header
to reorder". A visible "Reset layout" button.

## Accessibility / reduced motion

- Both sections are real grids with the surface's existing a11y (roles, keyboard).
- No streaming/animation here, so reduced-motion needs no special handling beyond
  what `ScrollReveal` already does. The flash/tick animations don't apply.

## Testing

**Unit (vitest, website):**

- `scaleData`: `makeScaleRows()` length 2500 and ids `"0".."2499"`;
  `makeScaleColumns()` length 500, header labels `C1..C500`, value accessor is
  deterministic (same row+col → same value; differs across cells).
- `useRenderedCellCount`: given a container with N matching nodes returns N;
  recomputes after nodes change (jsdom).
- `useInView`: toggles to `true` when the observer reports intersection
  (mock `IntersectionObserver`).

**Component (RTL):**

- `ScaleGrid` once in view renders far fewer `[data-pretable-cell]` nodes than
  `ROW_COUNT * COL_COUNT` (i.e. virtualization is on), and the counter text shows
  the model total `1,250,000` (or formatted) and a much smaller DOM number.
- `ColumnLayoutGrid` renders the portfolio headers; clicking "Reset layout"
  remounts (assert the grid is present again / key changed effect). Resize/reorder
  drag is exercised in smoke rather than RTL (drag is awkward in jsdom).

**E2E (Playwright smoke, `e2e/smoke.spec.ts`):** one new test —

- Open drawer, scroll the Scale section into view, assert the grid viewport
  renders and the counter shows the model total and a DOM count `< 1000`
  (proving virtualization). Scroll the grid and assert the DOM count stays small.
- Scroll the Column-layout section into view; perform a column-border drag and
  assert a column width changed; click "Reset layout" and assert it restores.
  (If header-drag reorder proves flaky in CI, cover resize + reset only and leave
  reorder to RTL/manual — note the gap in the test rather than silently dropping.)

## Risks / mitigations

- **Initial-load cost.** Mitigated by lazy mounting (grids mount only when scrolled
  near) — verify with a quick manual perf check that the homepage TTI isn't
  regressed.
- **Counter honesty.** We count real DOM nodes, not a derived estimate, so the
  number is defensible.
- **Drag flakiness in CI.** Reset-via-remount keeps the reset deterministic;
  resize/reorder asserted in smoke with an RTL fallback for reorder if needed.

## File summary

New, all under `apps/website/app/components/`:

- `ScaleShowcase.tsx`, `ColumnLayoutShowcase.tsx`
- `showcase/ScaleGrid.tsx`, `showcase/ColumnLayoutGrid.tsx`
- `showcase/scaleData.ts`, `showcase/columnLayoutData.ts`
- `showcase/useRenderedCellCount.ts`, `showcase/useInView.ts`
- `showcase/scaleGrid.module.css` (+ a small module for the layout section if
  needed)
- tests under `app/components/__tests__/` (mirroring existing layout)
- one new case in `e2e/smoke.spec.ts`

Edited:

- `app/page.tsx` (insert the two sections)
