# Right-Pinned Columns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen column pinning from `"left"` to `"left" | "right"` across engine, layout planner, renderer, surface sticky sites, CSS, controlled state, showcase, and docs. Config/API-only — no pin UI affordance.

**Architecture:** `planColumns` (`layout-core`) grows a third bucket: right-pinned columns are pulled out of the scroll flow, always emitted, and carry a `right` offset measured from the viewport's right edge. The scrollable virtualization window shrinks by **both** pinned widths. The surface mirrors its existing sticky-left machinery (a `pinnedOffsets` memo + `getPinnedCellStyle`) with a right-side equivalent at every site.

**Tech Stack:** TypeScript, Vitest + RTL, vanilla CSS (`@pretable/ui`), api-extractor (required gate). Commands: `pnpm --filter @pretable-internal/layout-core test`, `... grid-core test`, `... renderer-dom test`, `pnpm --filter @pretable/react test`, `pnpm -r typecheck`/`lint`/`test`, `pnpm format`/`format:write`, `pnpm api`.

**Key facts (verified against code at `main` = #197):**

- `packages/layout-core/src/types.ts`: `PlannedColumn { index; id; left; width; pinned?: "left" }`; `ColumnPlan { columns; totalWidth; pinnedLeftWidth }`.
- `packages/layout-core/src/column-plan.ts:3` `planColumns`: loops columns, `col.pinned === "left"` → `pinned[]` with `left: pinnedLeftWidth` accumulator, else → `scrollable[]` with its own `scrollableLeft` accumulator; `totalWidth = pinnedLeftWidth + scrollableLeft`; early return when `scrollable.length === 0`; then a binary search for the first scrollable column visible at `scrollLeft`.
- `packages/renderer-dom/src/create-renderer.ts:46` passes `pinnedLeft` into `planViewport`; `:71-74` builds `columnInputs` (`{id, width, pinned}`); `:78-104` calls `planColumns` when `viewportWidth !== undefined`, else a fallback that computes sequential `left` and `pinnedLeftWidth`.
- `packages/grid-core/src/types.ts`: `pinned?: "left"` on `PretableColumn`, `setColumnPinned(columnId, "left" | null)` on `PretableEngine`; same signature in `packages/core/src/pretable-grid.ts:71`.
- `packages/react/src/pretable-surface.tsx`: `pinnedOffsets` memo at `:666`; consumed at `:1251-1256` (body cells, via `getPinnedCellStyle`), `:1352-1357` (header button), `:1372-1376` (resize handle, `left: pinnedOffset + effWidth - 4`), `:1700-1704` (filter-funnel slot, `left: pinnedOffset + effWidth - 22`), `:1803` (one more site — read it). `getPinnedCellStyle` lives in `packages/react/src/rendering.ts`.
- `packages/ui/src/grid.css:99`: the single `:where([data-pretable-cell][data-pretable-pinned="left"])` rule.
- `PretableSurfaceState.columnPinned?: Record<string, "left" | null>` in `use-pretable.ts`, applied via `grid.setColumnPinned`.
- Prior gotchas: run `pnpm format` before finishing; build react sequentially before `pnpm api` if a report looks stale; grep `*.mdx` when types change.

---

## Task 1: `layout-core` — three-bucket `planColumns`

**Files:**

- Modify: `packages/layout-core/src/types.ts`, `packages/layout-core/src/column-plan.ts`
- Test: `packages/layout-core/src/__tests__/` (extend the existing column-plan test file)

- [ ] **Step 1: Types.** `PlannedColumn`: `pinned?: "left" | "right"`, add `right?: number` (documented: set only for right-pinned; offset from the viewport's right edge). `ColumnPlan`: add `pinnedRightWidth: number`. `PlanColumnsInput`'s column shape widens its `pinned` too.

- [ ] **Step 2: Failing tests** (extend the column-plan tests). Fixture: 6 columns × 100px, viewportWidth 300, one pinned left (`c0`), two pinned right (`c4`, `c5`). Cover:
  - order is `[...left, ...visibleScrollable, ...right]`;
  - `right` offsets: `c5` (last) → `right: 0`, `c4` → `right: 100`; `pinnedRightWidth === 200`;
  - right-pinned columns are present at `scrollLeft: 0` **and** at max scroll (never virtualized away);
  - **shrunken window**: with 100 (left) + 200 (right) pinned out of a 300px viewport, the scrollable window is clamped to zero — assert no scrollable column is emitted, and nothing has negative width/left;
  - a case with room (viewportWidth 600) asserting the scrollable window excludes a column that _would_ be visible if the right-pinned width weren't subtracted;
  - all-columns-pinned (scrollable empty) returns both groups with correct `totalWidth`;
  - existing left-only behavior unchanged (the pre-existing tests must still pass untouched).

  Run: `pnpm --filter @pretable-internal/layout-core test` → FAIL.

- [ ] **Step 3: Implement.** In `planColumns`: three arrays (`pinnedLeft`, `scrollable`, `pinnedRight`) + `pinnedLeftWidth`/`pinnedRightWidth` accumulators. Left branch unchanged. New right branch collects entries (index/id/width) — compute each entry's `right` in a **second pass** over `pinnedRight` from the end (running total of widths of later right-pinned columns), since the offset depends on columns that come after. `totalWidth = pinnedLeftWidth + scrollableLeft + pinnedRightWidth`. Effective scrollable viewport:

  ```ts
  const scrollableViewport = Math.max(
    0,
    input.viewportWidth - pinnedLeftWidth - pinnedRightWidth,
  );
  ```

  and use `scrollableViewport` (not `input.viewportWidth`) in the visibility window computation. Early return when `scrollable.length === 0` → `{ columns: [...pinnedLeft, ...pinnedRight], totalWidth, pinnedLeftWidth, pinnedRightWidth }`. Final return concatenates `[...pinnedLeft, ...visibleScrollable, ...pinnedRight]`.

- [ ] **Step 4: Verify** `pnpm --filter @pretable-internal/layout-core test` + `typecheck` → PASS/clean.
- [ ] **Step 5: Commit** — `feat(layout-core): plan right-pinned columns (third bucket, shrunken scroll window)`

---

## Task 2: Engine + renderer plumbing

**Files:**

- Modify: `packages/grid-core/src/types.ts`, `create-grid-core.ts` (if `setColumnPinned` validates the literal), `packages/core/src/pretable-grid.ts`, `create-grid.ts` (signature only), `packages/renderer-dom/src/create-renderer.ts`
- Test: extend `packages/grid-core/src/__tests__/column-layout.test.ts`, `packages/renderer-dom/src/__tests__/renderer-dom.test.ts`

- [ ] **Step 1: Widen types.** `PretableColumn.pinned?: "left" | "right"`; `setColumnPinned(columnId: string, pinned: "left" | "right" | null): void` in `PretableEngine` and the public `PretableGrid`. Check `create-grid-core`'s `setColumnPinned` body for a hardcoded `"left"` comparison and widen it (keep its change-guard/emit semantics).
- [ ] **Step 2: Renderer.** `columnInputs` already forwards `pinned` — confirm the type flows. Forward `pinnedRightWidth` from `planColumns` if the renderer surfaces plan fields. In the **fallback path** (no `viewportWidth`), preserve `pinned` (already does) and add `pinnedRightWidth` to the returned shape so both paths agree. If `planViewport` takes `pinnedLeft` for row planning only, leave it; do NOT invent a `pinnedRight` param unless row planning needs it (read and decide).
- [ ] **Step 3: Tests.** grid-core: `setColumnPinned(id, "right")` sets it; re-pin left→right; `null` clears; emit-guard on no-op. renderer-dom: a right-pinned column appears in the plan with `pinned: "right"` and a `right` offset; `pinnedRightWidth` correct.
- [ ] **Step 4: Verify** `pnpm --filter @pretable-internal/grid-core test`, `... renderer-dom test`, `pnpm --filter @pretable/core typecheck`.
- [ ] **Step 5: Commit** — `feat(grid-core,renderer-dom): widen pinned to left | right`

---

## Task 3: Surface sticky-right + CSS

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`, `packages/react/src/rendering.ts`, `packages/react/src/use-pretable.ts` (controlled slice type), `packages/ui/src/grid.css`
- Test: new `packages/react/src/__tests__/right-pin-surface.test.tsx`

- [ ] **Step 1: Failing RTL tests.** Fixture: 6 columns, `first` pinned left, `actions` + `status` pinned right, explicit `widthPx`, a `viewportWidth` narrow enough to scroll. Assert:
  - the right-pinned body cell carries `data-pretable-pinned="right"` and an inline `position: sticky` with a `right` offset (last right-pinned → `right: 0px`, the one before → its width);
  - the **header button**, **resize handle**, and **filter-funnel slot** for a right-pinned column each carry the right-side sticky treatment (mirror of the left assertions — read the existing left-pin tests if any and mirror their locators);
  - two right-pinned columns stack in column order;
  - a left-pinned and a right-pinned column coexist (both sticky, opposite edges);
  - unpinned columns are unaffected.
    Run → FAIL.
- [ ] **Step 2: Implement.** Add a `pinnedRightOffsets` memo next to `pinnedOffsets` (`:666`) — keyed by column id, value = accumulated width of right-pinned columns **after** it (prefer reading `plannedCol.right` from the plan if it's already available at each site; only build a memo if the plan's value isn't in scope). Add `getPinnedRightCellStyle(offset)` to `rendering.ts` mirroring `getPinnedCellStyle` (`position: sticky`, `right`, same `zIndex` tier). Then mirror each site: `:1251` (body cell), `:1352` (header button), `:1372` (resize handle — right analogue of `left: pinnedOffset + effWidth - 4` is `right: pinnedRight + 0` at the column's left edge… **read the geometry and derive it correctly**; the handle sits on the column's trailing edge in both cases), `:1700` (funnel slot — mirror of `left: pinnedOffset + effWidth - 22`), `:1803`. Emit `data-pretable-pinned="right"` wherever `"left"` is emitted today.
- [ ] **Step 3: Controlled slice.** `PretableSurfaceState.columnPinned?: Record<string, "left" | "right" | null>` in `use-pretable.ts`; the apply loop passes the value straight to `setColumnPinned` (widen any `"left"`-only narrowing).
- [ ] **Step 4: CSS.** Mirror `grid.css:99`:
  ```css
  :where([data-pretable-cell][data-pretable-pinned="right"]) {
    /* same background + z-index as the left rule; border on the leading edge */
  }
  ```
  Read the left rule and mirror it faithfully (no new tokens).
- [ ] **Step 5: Verify** `pnpm --filter @pretable/react test` + `typecheck`, `pnpm --filter @pretable/ui test`.
- [ ] **Step 6: Commit** — `feat(react,ui): sticky right-pinned columns`

---

## Task 4: Showcase + docs + api + full validation

**Files:**

- Modify: `apps/website/app/components/showcase/columnLayoutData.ts` (+ its RTL test), `apps/website/content/docs/grid/column-layout.mdx`, `apps/website/content/docs/grid/api-reference.mdx`, `apps/website/content/docs/headless/api-reference.mdx`
- Generated: `*.api.md`

- [ ] **Step 1: Showcase.** Pin one column right in the column-layout showcase data (a natural choice: the trailing "Analyst note" or a compact numeric column — pick what reads well and keep the grid legible). Extend the showcase RTL test to assert `data-pretable-pinned="right"` renders. Do NOT change the reset-layout behavior.
- [ ] **Step 2: Docs.** `column-layout.mdx`: a "Pinning" subsection covering `pinned: "left" | "right"`, `setColumnPinned`, the controlled `columnPinned` slice, and that pinned columns are always rendered (never virtualized away). Update both api-reference pages (`pinned` type, `setColumnPinned` signature, `columnPinned` slice). Grep `*.mdx` for `pinned` and `"left"` to catch stale claims like "currently only left is supported".
- [ ] **Step 3: API.** `pnpm --filter @pretable/react build` (sequential, dodges the stale-dist race), then `pnpm api`; diff should show only the `pinned`/`setColumnPinned`/`columnPinned` widenings. Commit reports.
- [ ] **Step 4: Full validation.**
  ```bash
  pnpm -r typecheck && pnpm -r lint && pnpm -r test
  pnpm format          # format:write + recommit if it fails
  pnpm --filter @pretable/app-website build
  pnpm api             # second run must be a clean no-op
  ```
- [ ] **Step 5: Smoke.** `cd apps/website && pnpm build`; `npx next start -p 3123` (background); `BASE_URL=http://localhost:3123 pnpm smoke`; kill the server. Use `--workers=1` if the known pre-existing showcase resize-drag flake bites (NOT yours to fix). Existing steps must pass; the showcase grid now has a right-pinned column — if that shifts a locator, fix the locator, don't weaken the assertion.
- [ ] **Step 6: Commit** — `feat(website): right-pin in the column-layout showcase; document pinning; refresh API reports`

---

## Self-Review notes (for the executor)

- **Spec coverage:** three-bucket planner + shrunken window (T1) ✓; engine/renderer widening (T2) ✓; surface sticky-right at every site + CSS + controlled slice (T3) ✓; showcase, docs, api, validation (T4) ✓; no pin UI affordance anywhere ✓.
- **The load-bearing subtlety** is Task 1 Step 3's `scrollableViewport` — without subtracting `pinnedRightWidth`, columns behind the right-pinned group are wrongly treated as visible. It has a dedicated test.
- **Don't miss a sticky site.** Grep `pinnedOffset` in `pretable-surface.tsx` and confirm every hit has a right-side mirror before declaring Task 3 done.
- **Left-pin must be untouched** behaviorally: all pre-existing left-pin tests pass unmodified.
- **Type consistency:** `pinnedRightWidth`, `PlannedColumn.right`, `pinnedRightOffsets`, `getPinnedRightCellStyle`, `data-pretable-pinned="right"` used identically across tasks.
