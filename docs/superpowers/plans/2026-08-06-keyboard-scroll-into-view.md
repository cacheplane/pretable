# Keyboard Scroll-Into-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** When the engine's focus address changes, the scroll viewport follows it, so keyboard navigation can reach cells that are outside the rendered window or hidden behind a pinned column group.

**Architecture:** The scroll target is computed **mathematically in `layout-core`**, not via `Element.scrollIntoView()`. Two pure functions take the same layout inputs the planners already use and return the minimal scroll offset that reveals a target, or `null` when it is already visible. The React surface calls them from a single effect keyed on `snapshot.focus` and assigns `scrollTop` / `scrollLeft` on the viewport ref.

**Why not `scrollIntoView()`:** it needs a DOM node, and the whole bug is that the focus target is often not rendered. It also cannot know that a sticky pinned column is covering the cell — it would happily park the target underneath one — and the scroller sets `contain: content` + `contentVisibility: auto`, which has already caused surprising containment behavior in this codebase.

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react, Playwright.

---

## Background: the bug

`packages/react/src/pretable-surface.tsx:966-981`:

```tsx
useLayoutEffect(() => {
  if (!focusedRowId || !focusedColumnId) {
    return;
  }
  const cellNode = cellNodesRef.current.get(
    `${focusedRowId}::${focusedColumnId}`,
  );
  if (cellNode && document.activeElement !== cellNode) {
    cellNode.focus({ preventScroll: true });
  }
}, [focusedRowId, focusedColumnId]);
```

Two failure modes:

1. When the cell **is** rendered, `preventScroll: true` suppresses the browser's native scroll-on-focus, and nothing replaces it.
2. When the cell is **not** rendered — normal, since rows and columns are both virtualized — the map lookup misses and the effect does nothing at all. Focus advances in the engine while DOM focus stays on the old cell.

`apps/website/content/docs/grid/keyboard.mdx:47` claims "Scrolling adjusts to keep the focused cell on-screen if needed." That is false today. `Cmd+Home`/`Cmd+End`/`PageUp`/`PageDown`/`Cmd+Arrow` all move focus to a cell that is almost certainly not rendered, so they currently appear to do nothing.

## Key facts this design depends on

- **One element scrolls both axes**: the surface root, `[data-pretable-scroll-viewport]`, `ref={viewportRef}` (`pretable-surface.tsx:1067-1296`).
- **The header row is inside the scroller and sticky** (`position: sticky; top: 0`). Row `top` values are local to `[data-pretable-scroll-content]`, which sits below the header. At `scrollTop = S`, the _unoccluded_ band in scroll-content coordinates is exactly `[S, S + bodyViewportHeight]` where `bodyViewportHeight = max(viewportHeight - headerHeight, 0)` (`pretable-surface.tsx:591`). **Task 1 must verify this relationship rather than assume it.**
- **Row heights are variable and partly estimated.** `PrefixSumsRowMetricsIndex` (`packages/layout-core/src/prefix-sums.ts:9-106`) is built over **every** visible row, not just rendered ones, so `getOffsetForIndex(i)` / `getHeight(i)` are exact for any index — but only against the current mix of measured and estimated heights. Only rendered rows are ever measured (`pretable-surface.tsx:999-1064`), and heights ≤ 44 are never cached.
- **`overflowAnchor: "none"`** (`styles.ts:21`) — the browser will not compensate when content above the viewport changes height. The surface owns that.
- **Pinned columns are never virtualized away** — `planColumns` always emits `[...pinnedLeft, ...visibleScrollable, ...pinnedRight]` (`column-plan.ts:147`).
- **`pinnedLeftWidth` / `pinnedRightWidth` are computed by `planColumns` but dropped** by `createDomRenderSnapshot` (`create-renderer.ts:97-106`), so the surface cannot see them today.
- **Scroll state lives in engine state** via `grid.setViewport` (`create-grid-core.ts:546-558`), which self-guards against no-op updates. Assigning `viewportRef.current.scrollTop` fires a native `scroll` event, so the existing `onScroll` handler feeds the engine — **do not call `setViewport` manually** from the new code.

## Do not duplicate layout math

PR #203 fixed a bug whose root cause was exactly this: `renderer-dom` had a hand-rolled column plan that drifted from `planColumns`. Every offset this feature needs must come from `layout-core`, either by calling it or by having the renderer pass its output through. **Do not re-derive row offsets or column offsets in `packages/react`.**

Note `pretable-surface.tsx:742-761` has a `columnLefts`/`columnWidths` memo whose gap-fill for off-window columns accumulates in raw declaration order — it is only correct when pinned columns are contiguous at the ends. **Do not build on it.**

---

## File Structure

**Create:**

- `packages/layout-core/src/scroll-to-reveal.ts` — the two pure functions.
- `packages/layout-core/src/__tests__/scroll-to-reveal.test.ts` — exhaustive unit coverage.

**Modify:**

- `packages/layout-core/src/index.ts` — export the new functions and types.
- `packages/layout-core/src/types.ts` — input/output types if they belong there rather than in the new module.
- `packages/renderer-dom/src/create-renderer.ts` — pass through `pinnedLeftWidth`, `pinnedRightWidth`, and row-metrics access.
- `packages/renderer-dom/src/types.ts` — `DomRenderSnapshot` gains those fields.
- `packages/react/src/use-pretable.ts` — `PretableRenderSnapshot` gains them.
- `packages/react/src/pretable-surface.tsx` — the scroll effect.
- `apps/website/content/docs/grid/keyboard.mdx` — make the claim true and describe the actual rule.
- `apps/website/e2e/smoke.spec.ts` — real-browser coverage.

---

## Task 1: Pure scroll math in `layout-core`

**Files:**

- Create: `packages/layout-core/src/scroll-to-reveal.ts`
- Create: `packages/layout-core/src/__tests__/scroll-to-reveal.test.ts`
- Modify: `packages/layout-core/src/index.ts`

Two functions. Both return `null` when no scrolling is needed, so the caller can skip the DOM write entirely.

```ts
export interface ScrollTopToRevealInput {
  rowMetrics: RowMetricsIndex;
  targetIndex: number;
  scrollTop: number;
  /** Unoccluded height: the scroller's height minus the sticky header. */
  viewportHeight: number;
}

/** Minimal `scrollTop` that fully reveals the target row, or null if it already is. */
export function scrollTopToReveal(input: ScrollTopToRevealInput): number | null;

export interface ScrollLeftToRevealInput {
  /** Engine-order columns, same shape planColumns consumes. */
  columns: PlanColumnsColumnInput[];
  targetColumnId: string;
  scrollLeft: number;
  viewportWidth: number;
}

/** Minimal `scrollLeft` that fully reveals the target column, or null. */
export function scrollLeftToReveal(
  input: ScrollLeftToRevealInput,
): number | null;
```

**Vertical rule.** Let `top = rowMetrics.getOffsetForIndex(targetIndex)` and `bottom = top + rowMetrics.getHeight(targetIndex)`.

- If `top < scrollTop` → return `top` (scroll up minimally).
- Else if `bottom > scrollTop + viewportHeight` → return `bottom - viewportHeight` (scroll down minimally).
- Else → `null`.
- A row taller than the viewport can't fully fit: prefer its **top** edge, so the first line is readable. Make sure the two branches are ordered so this falls out rather than oscillating.
- Clamp the result to `[0, max(0, totalHeight - viewportHeight)]`.

**Horizontal rule.** Reuse `planColumns`' bucketing — do not re-implement it. A **pinned** target (either side) is always visible: return `null` immediately. For a scrollable target, the unoccluded band is `[scrollLeft + pinnedLeftWidth, scrollLeft + viewportWidth - pinnedRightWidth]` in content coordinates, and the column's content offset is its `left` as `planColumns` reports it.

- If `left < scrollLeft + pinnedLeftWidth` → return `left - pinnedLeftWidth`.
- Else if `left + width > scrollLeft + viewportWidth - pinnedRightWidth` → return `left + width - viewportWidth + pinnedRightWidth`.
- Else → `null`.
- Clamp to `[0, max(0, totalWidth - viewportWidth)]`.
- If `pinnedLeftWidth + pinnedRightWidth >= viewportWidth` the band is empty or negative — return `null` rather than a nonsense offset, and comment why.
- Unknown `targetColumnId` → `null`.

**Steps:**

- [ ] **Step 1: Verify the coordinate relationship before writing code.** Read `packages/react/src/styles.ts:14-62` and `pretable-surface.tsx:591, 1843-1849`. Confirm in a comment at the top of `scroll-to-reveal.ts` that row `top`s are scroll-content-local and that the unoccluded band at `scrollTop = S` is `[S, S + bodyViewportHeight]`. **If the sticky header does not make this exact, say so in your report and stop** — the rest of the vertical math depends on it.

- [ ] **Step 2: Write the failing tests.** Cover, for vertical: target above / below / already visible; first and last row; a row taller than the viewport; `viewportHeight` of 0; empty grid (`rowCount === 0`); variable heights via `createRowMetricsIndex([40, 120, 44, 300, 44])`; clamping at both ends. For horizontal: scrollable target left of / right of / inside the band; a left-pinned target; a right-pinned target; both groups present; a target exactly at a band edge (off-by-one guard); pinned groups wider than the viewport; unknown column id; `viewportWidth` of 0. Assert exact numbers, not ranges.

- [ ] **Step 3: Run and confirm they fail.** `pnpm --filter @pretable-internal/layout-core test`

- [ ] **Step 4: Implement.** Keep both functions pure and allocation-light — `scrollTopToReveal` is on the ArrowDown hot path, which has a documented p95 < 16ms gate (`docs/superpowers/specs/2026-05-05-selection-keyboard-nav-design.md:237`).

- [ ] **Step 5: Run tests, confirm green. Commit.**

---

## Task 2: Expose what the surface needs

The surface can currently see neither `pinnedLeftWidth`/`pinnedRightWidth` nor any row offset outside the rendered window.

**Files:**

- Modify: `packages/renderer-dom/src/types.ts`, `packages/renderer-dom/src/create-renderer.ts`
- Modify: `packages/react/src/use-pretable.ts`
- Test: `packages/renderer-dom/src/__tests__/renderer-dom.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests** asserting `createDomRenderSnapshot` returns `pinnedLeftWidth` / `pinnedRightWidth` matching the `planColumns` output, and exposes row metrics covering a row **outside** the rendered window.

- [ ] **Step 2: Add the fields.** `DomRenderSnapshot` gains `pinnedLeftWidth: number`, `pinnedRightWidth: number`, and row-metrics access.

  For row metrics, prefer exposing the existing `RowMetricsIndex` instance directly (`create-renderer.ts:41` already builds one over all visible rows) over inventing a new shape. If that leaks an awkward type into the public React surface, expose a narrow `getRowLayout(index): { top: number; height: number } | null` instead — **decide based on what `PretableRenderSnapshot` can carry without churning the public API, and state your reasoning in your report.**

- [ ] **Step 3: Mirror onto `PretableRenderSnapshot`** in `use-pretable.ts:40-48`.

- [ ] **Step 4: Run `pnpm api`.** `PretableRenderSnapshot` may be public; if the report changes, commit it. If the change would expose an internal `layout-core` type through `@pretable/react`'s public API, **stop and report** — that needs a decision, not a workaround.

- [ ] **Step 5: Tests green. Commit.**

---

## Task 3: Wire the scroll effect into the surface

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`
- Test: `packages/react/src/__tests__/` (new file, e.g. `focus-scroll.test.tsx`)

**Steps:**

- [ ] **Step 1: Write the failing integration tests.** These must include the real bug: **focus moves to a row far outside the rendered window, and the viewport scrolls to it.** Follow the jsdom stub pattern in `right-pin-surface.test.tsx:9-52` (only `clientWidth` is stubbed today; you will also need `clientHeight` and writable `scrollTop`/`scrollLeft`, so extend the pattern and comment on what jsdom can and cannot prove).

  Cover: ArrowDown past the window bottom scrolls down; ArrowUp past the top scrolls up; `Cmd+End` jumps to the last cell and scrolls both axes; ArrowRight onto a column behind the right-pinned group scrolls horizontally; focusing an already-visible cell writes **no** scroll (assert the property was not assigned — this is the guard against fighting the user); focus on a left-pinned or right-pinned column never scrolls horizontally.

- [ ] **Step 2: Confirm they fail.**

- [ ] **Step 3: Implement the effect.**

  Add a single effect near the existing focus-follow effect. It must:
  - Resolve the focused row's **index** from `snapshot.visibleRows`. A linear scan per keypress is not acceptable on the ArrowDown hot path — build a memoized `Map<rowId, index>` keyed on `snapshot.visibleRows` identity.
  - Call both pure functions, and assign `viewportRef.current.scrollTop` / `.scrollLeft` **only** when the function returns non-null.
  - **Not** call `grid.setViewport` — assigning scroll fires a native `scroll` event and the existing `onScroll` handler (`:1280-1291`) already feeds the engine.
  - Leave `focus({ preventScroll: true })` in place. We now own scrolling deliberately; native focus scroll would fight our math and ignore the pinned groups. Update the comment above it to say so.

  **Handle the measure-then-scroll convergence problem.** Scrolling to a distant row uses _estimated_ heights for the rows in between; once the target renders it gets measured, which changes every subsequent `top`, so the scroll offset that was correct is now slightly wrong. Use a pending-target ref: when the focus address changes, record it; run the effect on focus **and** on `measuredHeights`; re-assert the scroll while the target is still not fully visible; clear the pending target once it is. This converges (the target stops moving once its neighbourhood is measured) and, crucially, **must not re-scroll for a focus address that is already satisfied** — otherwise a user who scrolls the focused cell out of view gets yanked back on the next measurement.

  Bound the retries and comment the bound, so a pathological case degrades to "slightly off" rather than an infinite scroll loop.

- [ ] **Step 4: Tests green.**

- [ ] **Step 5: Check the row-select column.** `ROW_SELECT_COLUMN_ID` is synthetic and left-pinned; confirm focusing it does not produce a horizontal scroll. Add a test.

- [ ] **Step 6: Commit.**

---

## Task 4: Docs and real-browser verification

**Files:**

- Modify: `apps/website/content/docs/grid/keyboard.mdx`
- Modify: `apps/website/e2e/smoke.spec.ts`

**Steps:**

- [ ] **Step 1: Fix the docs.** `keyboard.mdx:47` currently asserts scrolling adjusts. Replace the hand-wave with the actual rule: minimal scroll, the target is revealed clear of both pinned column groups and the sticky header, and an already-visible target causes no scroll. Mention that `usePretable` consumers get the `tabIndex` half from the snippet at `:49-58` but must implement scrolling themselves if they render their own DOM — the snippet is currently silent on this.

- [ ] **Step 2: Add Playwright coverage.** jsdom does no layout, so the integration tests prove only the _style/property writes_; this is the honest test. Model it on the horizontal-scroll harness at `smoke.spec.ts:308-392`. Assert: click a cell, press ArrowDown enough times to leave the window, and confirm (a) `scrollTop` increased and (b) the focused cell's `getBoundingClientRect()` lies within the viewport's rect and is not covered by the sticky header. Then `Cmd/Control+End` and assert both axes moved and the focused cell is clear of the right-pinned group.

  Use the existing `expect.poll` pattern. Note these run against a **deployed** origin (`BASE_URL`), so they gate on the preview deploy, not a local build.

- [ ] **Step 3: Commit.**

---

## Self-review checklist

- No layout math duplicated in `packages/react` — every offset traces to `layout-core`.
- The already-visible case writes nothing (no scroll fighting).
- Pinned columns never trigger horizontal scroll.
- The convergence loop is bounded and cannot fight a user's manual scroll.
- `keyboard.mdx` no longer claims anything untrue.
