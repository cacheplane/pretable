# Tool Panel SP5 — Pane Resizing + Auto Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pane width resizing (drag + keyboard, controlled/uncontrolled) and the columns section's auto-width affordances (kebab toggle + auto-size-all footer action), per `docs/superpowers/specs/2026-08-30-tool-panel-resize-autosize.md`.

**Architecture:** Resizing is React chrome state (the `activeSection` pattern) applied as an inline `inline-size` only after first interaction; the handle is a `role="separator"` strip on the pane's inline-start edge. Auto width rides the existing `createAutoWidthStore` — one new public handle method (`setColumnAutoWidth`), no engine changes.

**Tech Stack:** React 19, TypeScript, vitest via the package `test` script (never bare `vitest run`; positional filters, never `--`), Playwright, api-extractor, changesets.

**Read first, every task:** the spec (decisions A1–A7, B1–B6); `packages/react/src/tool-panel/ToolPanel.tsx` + the `<ToolPanel>` render site and `PretableToolPanelConfig` in `pretable-surface.tsx`; `packages/react/src/tool-panel/useToolRowDrag.ts` (#527 — the drag conventions: capture at pointerdown, Escape-cancel, the comment register); `createAutoWidthStore` + `autosizeColumns` + `setColumnWidth` in `packages/react/src/pretable-model.ts` (~lines 420-440, 655-745); `packages/react/src/tool-panel/ColumnPinMenu.tsx` + `overlay/menu-keyboard.ts`; the keyboard-walk rosters in `apps/website/e2e/tool-panel.spec.ts` and `grid-tab-wrap-rows.spec.ts`; the coarse-pointer hit-area pattern and the pane block in `packages/ui/src/grid.css` (~1455-1480).

**House rules:** worktree only; no `git stash`; `pnpm format` before every commit (required gate); loaded box — isolate failures before believing; `pnpm build` before `pnpm api`; commit per task with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `setColumnAutoWidth` on the handle + Reset audit (B2, B4)

**Files:**
- Modify: `packages/react/src/pretable-model.ts` (facade + type)
- Modify: `packages/react/src/tool-panel/ColumnsSection.tsx` ONLY IF the Reset audit finds drift (see Step 3)
- Test: `packages/react/src/__tests__/column-auto-width.test.tsx` (new)

- [ ] **Step 1: Write the failing tests.**

```tsx
// Harness: a 2-column surface — "fixed" declares widthPx: 120, "fluid"
// declares NO width (starts auto). Capture the grid via onGridReady.
// Content strings chosen so auto width visibly differs between them
// (choose-data-that-can-disprove): render "x" vs a long string, assert the
// drawn header cell's offsetWidth/style width CHANGES when content changes
// while auto, and does NOT change after setColumnAutoWidth(id, false).

it("a column with no declared width starts auto; a declared one does not", ...);
it("setColumnAutoWidth(id, true) makes content drive the drawn width", ...);
it("setColumnAutoWidth(id, false) freezes the current width (no jump)", ...);
it("setColumnWidth still flips auto OFF (old behavior survives)", ...);
```

(Adapt: jsdom has no real text measurement — read how existing auto-width behavior is tested; if drawn-width assertions need the renderer's measure seam mocked, follow that precedent. If jsdom cannot observe content-driven width at all, assert the STORE membership through the surface (a data attribute or the kebab state added in Task 3) AND add the drawn-width proof to the Playwright task instead — note the substitution honestly in the test header.)

- [ ] **Step 2: Implement.** In `pretable-model.ts`: add `setColumnAutoWidth(columnId: TColumnId, auto: boolean)` to the `PretableReactGrid`/facade type beside `setColumnWidth`, TSDoc mirroring its conventions (declare-here-for-the-prototype-reach reason if applicable); implementation: `stores.autoWidths.setAuto(columnId as string, auto)`. Verify `autosizeColumns` and `setColumnWidth` interplay unchanged.
- [ ] **Step 3: The Reset audit (B4).** Read ColumnsSection's Reset action: does it restore the initial auto set? Write the test either way: Reset after `setColumnAutoWidth("fixed", true)` must return "fixed" to manual and "fluid" to auto (the initial state). If Reset today doesn't touch the store, wire it (the initial set = ids without declared widthPx — the store's own constructor rule; expose what's needed via existing seams, not new public API).
- [ ] **Step 4: Run the new file + the columns-section suites** (`pnpm --filter @pretable/react test column-auto-width tool-panel`). Mutation: make `setColumnAutoWidth` ignore its `auto` arg (always true) → the freeze test fails; revert.
- [ ] **Step 5: Format, lint, typecheck, commit** — `feat(react): setColumnAutoWidth on the grid handle (SP5)`.

---

### Task 2: pane resize — state, handle, pointer + keyboard (A1–A7)

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (config trio + state + clamp), `packages/react/src/tool-panel/ToolPanel.tsx` (the handle element + inline width application)
- Create: `packages/react/src/tool-panel/pane-resize.ts` (pure: clamp logic, step math, direction resolution — the testable-without-React split)
- Modify: `packages/ui/src/grid.css` (handle styling + coarse hit area; zero new tokens)
- Tests: `packages/react/src/__tests__/tool-panel-pane-resize.test.tsx` (new) + pure `tool-panel-pane-resize-math.test.ts`; extend `attribute-contract.test.tsx` (`data-pretable-pane-resize`, asserted non-vacuously)

- [ ] **Step 1: Pure module first, TDD.** `pane-resize.ts`: `clampPaneWidth(px, {min, max})`, `paneWidthAfterKey(key, current, {min, max, dir})` (arrows ±16, Home/End → min/max, direction-aware per A6), `paneWidthAfterDrag(startWidth, startX, currentX, dir, bounds)`. Write the table-driven tests red (both `ltr`/`rtl` rows — the direction flip is the mutation-prone branch), implement, green. MIN: measure the filters section's narrowest usable row in the browser once, record the number AND the measurement in a comment (A4's rule).
- [ ] **Step 2: Config + state.** `PretableToolPanelConfig` gains `defaultPaneWidthPx?/paneWidthPx?/onPaneWidthChange?` (TSDoc per the `activeSection` fields' register, incl. the A5 inline-style note and the clamp-and-report rule). Surface: uncontrolled `useState<number | null>(defaultPaneWidthPx ?? null)` (`null` = untouched → no inline style); controlled presence wins; every write path clamps then reports. Pass width + change callback + bounds into `<ToolPanel>`.
- [ ] **Step 3: The handle in ToolPanel.tsx.** Rendered at the pane's inline-start edge when a pane is open: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max`, `tabIndex={0}`, `data-pretable-pane-resize`, aria-label from a NEW message key `toolPanelResizeLabel` (add to messages layer per the established three-places pattern). Pointer: capture at pointerdown, live width updates via the pure drag math, Escape restores drag-start width (document-level listener while dragging, `preventDefault` interlock comment per the house pattern), release commits, double-click and Enter reset to default (clear to `null` when uncontrolled — restoring the stylesheet width per A5; controlled → report the default). Keyboard per the pure module.
- [ ] **Step 4: jsdom tests red then green** (spec Verification A list): drag/clamp/Escape/dblclick-reset/controlled-trio/clamp-report/no-inline-before-interaction/aria values/arrow steps both directions. Follow `useToolRowDrag`'s test techniques for pointer sequences.
- [ ] **Step 5: css** — the strip (reuse rule/hover tokens; a wider transparent hit area on coarse pointers via the established pattern); attribute-contract addition.
- [ ] **Step 6: Mutations:** invert the direction resolution → the rtl rows fail; drop the clamp on the controlled path → the clamp-report test fails. Revert, green.
- [ ] **Step 7: Full react suite + ui suite; format, lint, typecheck; commit** — `feat(react): the tool-panel pane resizes by pointer and keyboard (SP5)`.

---

### Task 3: the kebab toggle + footer action + rename (B1, B3, B5)

**Files:**
- Rename: `packages/react/src/tool-panel/ColumnPinMenu.tsx` → the honest name (B5; update imports/tests)
- Modify: the renamed menu (menuitemcheckbox "Auto width"), `ColumnsSection.tsx` (footer "Auto-size all columns" beside Reset; plumb `setColumnAutoWidth` + the auto set), messages (+`toolPanelAutoWidthLabel`, `toolPanelAutosizeAllLabel` — three places), `grid.css` if the checkbox item needs styling
- Tests: extend the menu's + columns-section's suites; attribute contract if new attributes

- [ ] **Step 1: Failing tests:** the menu shows "Auto width" checked/unchecked per the live set (fixed → unchecked, fluid → checked — reuse Task 1's harness shape); toggling writes through `setColumnAutoWidth` with the RIGHT column id (mutation target); `role="menuitemcheckbox"` + `aria-checked` correct; keyboard operation via the shared `useMenuKeyboard` (no fourth hand-rolled copy); footer button sets ALL columns auto (assert the store effect through the UI, e.g. every kebab now checked); Reset restores (extends Task 1's B4 test through the UI).
- [ ] **Step 2: Implement.** The section already subscribes to engine/layout state — the auto set needs its own subscription (`autoWidths.subscribe/getState` — check what the section can reach; plumb through the descriptor via a stable handle, respecting the DEPS RULE: the set is engine-ish state, so reach it by subscription, never bake it into the memo).
- [ ] **Step 3: Mutations:** wire the toggle to a constant column id → the per-column test fails; invert checked-state derivation → the reflect test fails. Revert.
- [ ] **Step 4: Run the tool-panel suites + full react suite; format, lint, typecheck; commit** — `feat(react): auto-width toggle and auto-size-all in the columns section (SP5)`.

---

### Task 4: e2e — the seam, the walks, the pixel proofs

**Files:**
- Modify: `apps/website/e2e/tool-panel.spec.ts` (+ possibly the fixtures page if the walk needs the handle)
- Verify: `grid-tab-wrap-rows.spec.ts` untouched-green

- [ ] **Step 1: New cases** (hydration-gated, helpers reused): (a) pointer-drag the seam → pane width changes AND the grid reflows (assert something grid-side: a header cell's x-position or the horizontal scrollbar state — prove the pixel, not the style); (b) keyboard: Tab reaches the handle inside the pane's roster (UPDATE every walk roster the handle joins — with the "update when…" comment style), arrows resize, Enter resets; tab-exit guard still green; (c) auto-width: toggle a column's "Auto width" in the kebab, stream/update content, the header width visibly changes; toggle off → frozen (this is the drawn-width proof if Task 1's jsdom couldn't observe it).
- [ ] **Step 2: Run per the recipe** (root build, website build, prod server on a free port, `--workers=1`, both browsers, twice; isolate any failure). Include `grid-tab-wrap-rows.spec.ts` in the run.
- [ ] **Step 3: Format/lint/typecheck website; commit** — `test(e2e): pane resize and auto width through the real shell (SP5)`.

---

### Task 5: docs, api, changesets, final verification

**Files:**
- Modify: `apps/website/content/docs/grid/tool-panel.mdx` (resizing subsection with the A5 css-override interplay note; the width trio joins the Configuration table; the columns-section prose gains the auto-width pair with B6's plain statement; new message keys join the strings listings — the #512 guard will demand them), handle docs for `setColumnAutoWidth` wherever the guard requires
- Create: changesets — `@pretable/react` minor, `@pretable/ui` patch

- [ ] **Step 1:** Docs + live-example touch-ups if the existing tool-panel example benefits (don't force one); run the website guard suite; satisfy every fail-closed demand honestly (SEO description ≤155 if touched).
- [ ] **Step 2:** `pnpm build` then `pnpm api`; commit reports; `api:check` green. Expected moves: the config trio, `setColumnAutoWidth`, new message keys.
- [ ] **Step 3:** Full verification: root build; react/ui/website suites; root lint + typecheck; format. Commit. Push branch, open PR `feat: tool-panel pane resizing and column auto width (SP5)` (body: spec decisions + test plan + generated-with footer). Merge on green only; read the merge back from origin/main.

---

## Self-review notes

- Spec coverage: A1→T2 (handle/css), A2→T2 (pointer/Escape/dblclick), A3→T2 (trio), A4→T2 (pure clamp + measured MIN), A5→T2 (null-state inline rule) + T5 docs, A6→T2+T4 (keyboard + rosters), A7→spec-only (no work); B1→T3, B2→T1, B3→T3, B4→T1+T3, B5→T3, B6→T5 docs. Verification section maps to T1–T4 tests + T5 gates.
- Names used consistently: `setColumnAutoWidth`, `defaultPaneWidthPx`/`paneWidthPx`/`onPaneWidthChange`, `pane-resize.ts` functions (T2 defines, T4 exercises), message keys `toolPanelResizeLabel`/`toolPanelAutoWidthLabel`/`toolPanelAutosizeAllLabel` (T2/T3 define, T5 documents).
- No engine (grid-core/row-model) changes anywhere — if a task finds itself editing them, stop and escalate.
- jsdom's text-measurement limitation is handled explicitly (T1 Step 1's substitution rule + T4's pixel proof), not discovered mid-task.
